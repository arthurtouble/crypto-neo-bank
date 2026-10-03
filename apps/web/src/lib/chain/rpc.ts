import { createPublicClient, fallback, http, type Chain, type PublicClient } from "viem";
import { BASE_CHAIN_ID } from "@/lib/assets/registry";
import { localEdgeUrl } from "@/lib/testing/local-edge";

export const RPC_BY_CHAIN: Record<number, readonly string[]> = {
  1: ["https://ethereum-rpc.publicnode.com"],
  10: ["https://mainnet.optimism.io"],
  // publicnode refused Worker traffic on dev (3 October 2026), so dRPC goes first.
  137: ["https://polygon.drpc.org", "https://polygon-bor-rpc.publicnode.com"],
  // publicnode refuses receipts without a token, so it is the last resort for Base.
  [BASE_CHAIN_ID]: ["https://mainnet.base.org", "https://base.drpc.org", "https://1rpc.io/base", "https://base-rpc.publicnode.com"],
  42161: ["https://arb1.arbitrum.io/rpc"]
};

/**
 * Endpoints to read a chain from, in order. A dedicated endpoint set as the
 * `RPC_URL_<chainId>` secret (for example an Alchemy URL) comes first; the
 * public ones stay as fallbacks, since they rate-limit shared Worker traffic.
 */
export function rpcEndpoints(chainId: number): readonly string[] {
  // A local node (end-to-end tests) is used alone, so a test never reaches a public network.
  const local = localEdgeUrl(`RPC_URL_${chainId}`);
  if (local) return [local];
  const dedicated = process.env[`RPC_URL_${chainId}`];
  const endpoints = RPC_BY_CHAIN[chainId] ?? [];
  return dedicated && /^https:\/\//.test(dedicated) ? [dedicated, ...endpoints] : endpoints;
}

/**
 * One JSON-RPC call to one endpoint. Throws on an HTTP error, a JSON-RPC
 * error, or an answer without a result; a `null` result is returned as is.
 */
export async function jsonRpc<T = unknown>(fetcher: typeof fetch, endpoint: string, method: string, params: unknown[], timeoutMs = 8_000): Promise<T> {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!response.ok) throw new Error(`Chain RPC returned ${response.status}.`);
  const payload = await response.json() as { result?: T; error?: unknown };
  if (payload.error || !("result" in payload) || payload.result === undefined) throw new Error("Chain RPC returned an error.");
  return payload.result;
}

/** A viem client for `chain` over its endpoints in order, each tried once before the next. */
export function publicClient(chain: Chain): PublicClient {
  return createPublicClient({ chain, transport: fallback(rpcEndpoints(chain.id).map((url) => http(url, { timeout: 8_000, retryCount: 0 }))) }) as PublicClient;
}
