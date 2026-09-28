import type { PrivyClient } from "@privy-io/node";
import { localEdgeUrl } from "@/lib/testing/local-edge";
import type { Call } from "./types";

/**
 * Money actions run on the customer's Privy embedded wallet. Aura's server
 * builds the exact Privy request, the customer signs it in the browser with
 * their authorization key, and the server relays it with Privy paying gas.
 * The server cannot send anything the customer did not sign, and the chain,
 * not Privy's answer, decides the outcome.
 */
export const PRIVY_API_URL = "https://api.privy.io";
const privyApiUrl = () => localEdgeUrl("PRIVY_API_URL") ?? PRIVY_API_URL;

export type SendCallsBody = {
  method: "wallet_sendCalls";
  caip2: `eip155:${number}`;
  sponsor: true;
  params: { calls: Array<{ to: string; data: string; value: string }> };
};

/** A message the customer's wallet signs to confirm a security change (`lib/security/step-up.ts`). */
export type PersonalSignBody = { method: "personal_sign"; chain_type: "ethereum"; params: { message: string; encoding: "utf-8" } };

/** Privy's authorization signature input, signed by the customer in the browser. Privy asks for their passkey first. */
export type AuthorizationRequest<Body = SendCallsBody> = {
  version: 1;
  method: "POST";
  url: string;
  body: Body;
  headers: { "privy-app-id": string; "privy-idempotency-key": string; "privy-request-expiry": string };
};

export function sendCallsRequest(input: { appId: string; walletId: string; chainId: number; calls: readonly Call[];
  idempotencyKey: string; expiresAt: Date }): AuthorizationRequest {
  return {
    version: 1,
    method: "POST",
    url: `${privyApiUrl()}/v1/wallets/${input.walletId}/rpc`,
    body: {
      method: "wallet_sendCalls",
      caip2: `eip155:${input.chainId}`,
      sponsor: true,
      params: { calls: input.calls.map((call) => ({ to: call.to, data: call.data, value: `0x${BigInt(call.value).toString(16)}` })) }
    },
    headers: {
      "privy-app-id": input.appId,
      "privy-idempotency-key": input.idempotencyKey,
      "privy-request-expiry": String(input.expiresAt.getTime())
    }
  };
}

export function personalSignRequest(input: { appId: string; walletId: string; message: string; idempotencyKey: string; expiresAt: Date }): AuthorizationRequest<PersonalSignBody> {
  return {
    version: 1,
    method: "POST",
    url: `${privyApiUrl()}/v1/wallets/${input.walletId}/rpc`,
    body: { method: "personal_sign", chain_type: "ethereum", params: { message: input.message, encoding: "utf-8" } },
    headers: { "privy-app-id": input.appId, "privy-idempotency-key": input.idempotencyKey, "privy-request-expiry": String(input.expiresAt.getTime()) }
  };
}

/**
 * Have Privy sign a confirmation with the customer's wallet. Privy only does
 * so for a valid authorization signature from the customer, which their
 * passkey unlocks, so a successful answer proves a fresh passkey check.
 */
export async function relayPersonalSign(privy: PrivyClient, walletId: string, request: AuthorizationRequest<PersonalSignBody>, signature: string): Promise<string> {
  const response = await privy.wallets().rpc(walletId, {
    ...request.body,
    idempotency_key: request.headers["privy-idempotency-key"],
    request_expiry: Number(request.headers["privy-request-expiry"]),
    authorization_context: { signatures: [signature] }
  });
  return (response.data as { signature: string }).signature;
}

/** Relay a signed request. The SDK rebuilds the same payload, so the customer's signature must match it exactly. */
export async function relaySendCalls(privy: PrivyClient, walletId: string, request: AuthorizationRequest, signature: string): Promise<string> {
  const response = await privy.wallets().rpc(walletId, {
    ...request.body,
    idempotency_key: request.headers["privy-idempotency-key"],
    request_expiry: Number(request.headers["privy-request-expiry"]),
    authorization_context: { signatures: [signature] }
  });
  return response.data.transaction_id;
}

export type RelayedTransaction =
  | { status: "pending" }
  | { status: "landed"; hash: string }
  | { status: "failed"; reason: string };

/** Where a relayed operation stands, as Privy reports it. Only the chain hash matters afterwards. */
export async function readRelayedTransaction(privy: PrivyClient, reference: string): Promise<RelayedTransaction> {
  const transaction = await privy.transactions().get(reference);
  if (transaction.transaction_hash && /^0x[a-fA-F0-9]{64}$/.test(transaction.transaction_hash)) {
    return { status: "landed", hash: transaction.transaction_hash.toLowerCase() };
  }
  if (transaction.status === "failed" || transaction.status === "provider_error") return { status: "failed", reason: `relay_${transaction.status}` };
  return { status: "pending" };
}
