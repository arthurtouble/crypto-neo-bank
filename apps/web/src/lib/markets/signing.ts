import type { PrivyClient } from "@privy-io/node";
import { PRIVY_APP_ID } from "@/config/client";
import { PRIVY_API_URL, type AuthorizationRequest } from "@/lib/actions/privy-relay";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import { privyClient } from "@/lib/auth/privy";
import type { ActionAccount } from "@/lib/auth/wallet";
import { HttpError } from "@/lib/http/errors";
import type { TypedData, Venue } from "./types";

/**
 * Something the customer's own wallet signs for a venue: approving Aura's
 * trading key on Hyperliquid, a withdrawal, a Polymarket order. The server
 * builds the exact EIP-712 data, the customer approves Privy's request to
 * sign it with their passkey, and the server relays it and gets the
 * signature. A request is kept for 5 minutes and used once, so a signature
 * can only ever be for the data the customer saw.
 */
export type MarketSignaturePurpose =
  | "hyperliquid_approve_agent" | "hyperliquid_withdraw" | "hyperliquid_agent_actions"
  | "polymarket_approvals" | "polymarket_clob_auth" | "polymarket_order" | "polymarket_withdraw" | "polymarket_redeem";

export type SignTypedDataBody = {
  method: "eth_signTypedData_v4";
  chain_type: "ethereum";
  params: { typed_data: { domain: TypedData["domain"]; types: TypedData["types"]; primary_type: string; message: TypedData["message"] } };
};

export type MarketSignatureRequest = { requestId: string; request: AuthorizationRequest<SignTypedDataBody> };
export type SignedMarketRequest<Context> = { typedData: TypedData; context: Context; signature: `0x${string}`; purpose: MarketSignaturePurpose };

const TTL_MS = 5 * 60_000;
const privyApiUrl = () => localEdgeUrl("PRIVY_API_URL") ?? PRIVY_API_URL;

/** Privy's request to sign `typedData` with the customer's wallet, as their authorization key must sign it. */
export function signTypedDataRequest(input: { appId: string; walletId: string; typedData: TypedData; idempotencyKey: string; expiresAt: Date }): AuthorizationRequest<SignTypedDataBody> {
  const { domain, types, primaryType, message } = input.typedData;
  return {
    version: 1,
    method: "POST",
    url: `${privyApiUrl()}/v1/wallets/${input.walletId}/rpc`,
    body: { method: "eth_signTypedData_v4", chain_type: "ethereum", params: { typed_data: { domain, types, primary_type: primaryType, message } } },
    headers: { "privy-app-id": input.appId, "privy-idempotency-key": input.idempotencyKey, "privy-request-expiry": String(input.expiresAt.getTime()) }
  };
}

/** Relay a signed request to Privy; Privy signs only for the customer's valid authorization signature. */
export async function relaySignTypedData(privy: PrivyClient, walletId: string, request: AuthorizationRequest<SignTypedDataBody>, signature: string): Promise<`0x${string}`> {
  const result = await privy.wallets().rpc(walletId, {
    ...request.body,
    idempotency_key: request.headers["privy-idempotency-key"],
    request_expiry: Number(request.headers["privy-request-expiry"]),
    authorization_context: { signatures: [signature] }
  } as Parameters<ReturnType<PrivyClient["wallets"]>["rpc"]>[1]);
  const signed = (result.data as { signature?: unknown }).signature;
  if (typeof signed !== "string" || !/^0x[0-9a-fA-F]{130}$/.test(signed)) throw new Error("Privy returned an invalid signature.");
  return signed.toLowerCase() as `0x${string}`;
}

const requestFor = (account: ActionAccount, requestId: string, typedData: TypedData, expiresAt: Date) =>
  signTypedDataRequest({ appId: PRIVY_APP_ID, walletId: account.walletId, typedData, idempotencyKey: `aura-market-${requestId}`, expiresAt });

/** Keep `typedData` for the customer to sign, with what to do once signed (`context`). */
export async function createMarketSignature(db: D1Database, subject: string, account: ActionAccount, venue: Venue,
  purpose: MarketSignaturePurpose, typedData: TypedData, context: unknown, now = new Date()): Promise<MarketSignatureRequest> {
  const requestId = crypto.randomUUID();
  const expiresAt = new Date(now.getTime() + TTL_MS);
  await db.prepare(`INSERT INTO market_signature_requests (request_id, subject_reference, venue, purpose, typed_data_json, context_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(requestId, subject, venue, purpose, JSON.stringify(typedData), JSON.stringify(context ?? null),
    now.toISOString(), expiresAt.toISOString()).run();
  return { requestId, request: requestFor(account, requestId, typedData, expiresAt) };
}

type RequestRow = { venue: string; purpose: string; typed_data_json: string; context_json: string; expires_at: string; used_at: string | null };

/** Use a stored request once: check it is this customer's, for this venue and purpose, and live; then claim it. */
async function claimRequest(db: D1Database, subject: string, venue: Venue, purposes: readonly MarketSignaturePurpose[], requestId: string,
  now: Date): Promise<RequestRow> {
  const row = await db.prepare(`SELECT venue, purpose, typed_data_json, context_json, expires_at, used_at FROM market_signature_requests
    WHERE request_id = ? AND subject_reference = ?`).bind(requestId, subject).first<RequestRow>();
  const expired = new HttpError(409, "signature_expired", "This request expired. Try again.");
  if (!row || row.venue !== venue || !purposes.includes(row.purpose as MarketSignaturePurpose))
    throw new HttpError(409, "signature_mismatch", "This approval was for something else. Try again.");
  if (row.used_at || row.expires_at <= now.toISOString()) throw expired;
  const claimed = await db.prepare("UPDATE market_signature_requests SET used_at = ? WHERE request_id = ? AND used_at IS NULL")
    .bind(now.toISOString(), requestId).run();
  if ((claimed.meta.changes ?? 0) !== 1) throw expired;
  return row;
}

/**
 * Venue actions for the customer's device key to sign: on Hyperliquid, the
 * trading key their browser made and their wallet approved. Aura never holds
 * that key; it builds the actions, the browser signs them, and Aura relays
 * exactly what it built. Kept 5 minutes and used once, like a passkey request.
 */
export type DeviceSignRequest = { status: "sign"; requestId: string; owner: `0x${string}`; typedData: TypedData[] };

export async function createDeviceSignature(db: D1Database, subject: string, owner: `0x${string}`, venue: Venue, purpose: MarketSignaturePurpose,
  typedData: TypedData[], context: unknown, now = new Date()): Promise<DeviceSignRequest> {
  const requestId = crypto.randomUUID();
  await db.prepare(`INSERT INTO market_signature_requests (request_id, subject_reference, venue, purpose, typed_data_json, context_json, created_at, expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).bind(requestId, subject, venue, purpose, JSON.stringify(typedData), JSON.stringify(context ?? null),
    now.toISOString(), new Date(now.getTime() + TTL_MS).toISOString()).run();
  return { status: "sign", requestId, owner, typedData };
}

/** Claim a device request once, with the typed data it was for. The caller checks the signatures. */
export async function claimDeviceSignature<Context>(db: D1Database, subject: string, venue: Venue, purpose: MarketSignaturePurpose, requestId: string,
  now = new Date()): Promise<{ typedData: TypedData[]; context: Context }> {
  const row = await claimRequest(db, subject, venue, [purpose], requestId, now);
  return { typedData: JSON.parse(row.typed_data_json) as TypedData[], context: JSON.parse(row.context_json) as Context };
}

/**
 * Use a signature request once: check it is this customer's, for this venue and purpose, and live; claim it; then
 * have Privy sign with the customer's authorization signature. Privy refusing it means nothing was signed.
 */
export async function completeMarketSignature<Context>(db: D1Database, subject: string, account: ActionAccount, venue: Venue,
  purposes: readonly MarketSignaturePurpose[], requestId: string, authorization: string, now = new Date(),
  relay: typeof relaySignTypedData = relaySignTypedData, privy?: PrivyClient): Promise<SignedMarketRequest<Context>> {
  const row = await claimRequest(db, subject, venue, purposes, requestId, now);
  const typedData = JSON.parse(row.typed_data_json) as TypedData;
  let signature: `0x${string}`;
  try { signature = await relay(privy ?? privyClient(), account.walletId, requestFor(account, requestId, typedData, new Date(row.expires_at)), authorization); }
  catch (error) {
    const status = (error as { status?: unknown }).status;
    if (typeof status === "number" && status >= 400 && status < 500) throw new HttpError(403, "signature_rejected", "Your passkey approval wasn't accepted. Nothing was sent.");
    throw error;
  }
  return { typedData, context: JSON.parse(row.context_json) as Context, signature, purpose: row.purpose as MarketSignaturePurpose };
}
