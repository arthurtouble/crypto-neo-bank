import { getAddress, isAddress } from "viem";
import { z } from "zod";
import { VenueError, type TypedData } from "../types";
import { assertOwnerSignature } from "./account";
import { POLYGON_CHAIN_ID, l2Headers, polymarketRequest, type ApiCredentials, type RequestOptions } from "./http";

/**
 * CLOB authentication. The owner wallet signs `ClobAuth` once (L1) to get
 * an API key for its account; Aura seals that key (`../credentials.ts`)
 * and signs each later CLOB request with it (L2 HMAC, see `l2Headers`).
 */

export const CLOB_AUTH_MESSAGE = "This message attests that I control the given wallet";

/** The L1 `ClobAuth` typed data the owner signs. `timestamp` is Unix seconds; the CLOB rejects stale ones. */
export function clobAuthTypedData(ownerAddress: string, timestamp: number, nonce = 0): TypedData {
  if (!isAddress(ownerAddress, { strict: false }) || !Number.isSafeInteger(timestamp) || timestamp <= 0 || !Number.isSafeInteger(nonce) || nonce < 0) {
    throw new VenueError("polymarket", "invalid_request", "Invalid sign-in request.", 400);
  }
  return {
    domain: { name: "ClobAuthDomain", version: "1", chainId: POLYGON_CHAIN_ID },
    types: {
      EIP712Domain: [{ name: "name", type: "string" }, { name: "version", type: "string" }, { name: "chainId", type: "uint256" }],
      ClobAuth: [{ name: "address", type: "address" }, { name: "timestamp", type: "string" }, { name: "nonce", type: "uint256" }, { name: "message", type: "string" }]
    },
    primaryType: "ClobAuth",
    message: { address: getAddress(ownerAddress), timestamp: String(timestamp), nonce: String(nonce), message: CLOB_AUTH_MESSAGE }
  };
}

const credentialsSchema = z.object({ apiKey: z.string().min(1).max(200), secret: z.string().min(1).max(500), passphrase: z.string().min(1).max(500) })
  .transform(({ apiKey, secret, passphrase }): ApiCredentials => ({ key: apiKey, secret, passphrase }));

/**
 * Create the owner's CLOB API key from a signed `ClobAuth`, or derive the
 * existing one when the CLOB says it already exists (HTTP 400), as the SDK does.
 */
export async function createOrDeriveApiKey(input: { ownerAddress: string; signature: string; timestamp: number; nonce?: number }, options: RequestOptions = {}): Promise<ApiCredentials> {
  const nonce = input.nonce ?? 0;
  await assertOwnerSignature(clobAuthTypedData(input.ownerAddress, input.timestamp, nonce), input.signature, input.ownerAddress);
  const headers = { POLY_ADDRESS: getAddress(input.ownerAddress), POLY_NONCE: String(nonce), POLY_SIGNATURE: input.signature.toLowerCase(), POLY_TIMESTAMP: String(input.timestamp) };
  try {
    return await polymarketRequest({ service: "clob", method: "POST", path: "/auth/api-key", headers, schema: credentialsSchema, fetcher: options.fetcher });
  } catch (error) {
    if (!(error instanceof VenueError) || error.code !== "rejected") throw error;
  }
  return polymarketRequest({ service: "clob", path: "/auth/derive-api-key", headers, schema: credentialsSchema, fetcher: options.fetcher });
}

export type ClobSession = { credentials: ApiCredentials; ownerAddress: string };

/** A signer for CLOB requests made on the owner's behalf with their API key. */
export const clobSigner = (session: ClobSession, now?: Date) =>
  (method: string, path: string, body: string | undefined) => l2Headers(session.credentials, getAddress(session.ownerAddress), method, path, body, now);

/**
 * Ask the CLOB to re-read the wallet's balance and allowances from chain.
 * Run after the approvals batch confirms and after a deposit lands, and for
 * a token before its first sell.
 */
export async function syncClobAllowance(session: ClobSession, asset: { type: "COLLATERAL" } | { type: "CONDITIONAL"; tokenId: string }, options: RequestOptions = {}): Promise<void> {
  if (asset.type === "CONDITIONAL" && !/^\d{1,78}$/.test(asset.tokenId)) throw new VenueError("polymarket", "invalid_request", "Unknown outcome.", 400);
  await polymarketRequest({
    service: "clob", path: "/balance-allowance/update",
    query: { asset_type: asset.type, token_id: asset.type === "CONDITIONAL" ? asset.tokenId : undefined, signature_type: 3 },
    sign: clobSigner(session), schema: z.undefined(), ignoreBody: true, fetcher: options.fetcher
  });
}
