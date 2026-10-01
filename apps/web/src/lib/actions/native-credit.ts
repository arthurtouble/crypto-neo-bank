import { isAddress } from "viem";
import { z } from "zod";
import { jsonRpc as rpc, rpcEndpoints } from "@/lib/chain/rpc";

/**
 * Native ETH has no Transfer log, so a route that pays out ETH can't be
 * checked from the operation's logs like a token. Two chain reads can show it:
 *
 * - `trace`: the transaction's call tree (`debug_traceTransaction` with
 *   `callTracer`), summing the value of every call that reached the recipient
 *   and didn't revert. Exact for this transaction, but public endpoints
 *   rarely serve it; a dedicated `RPC_URL_<chainId>` endpoint may.
 * - `balance`: the recipient's ETH balance at the block before and at the
 *   transaction's block (`eth_getBalance`), on an endpoint that agrees on the
 *   block's hash. Anything else that paid or was paid by the recipient in the
 *   same block is counted too: another incoming transfer can make a short
 *   payout look complete, and the recipient's own spending can hide a credit.
 *   So a credit of at least the minimum is accepted, and a shortfall is never
 *   treated as proof of failure. Endpoints that keep no history for the block
 *   refuse the read.
 *
 * Each observation is stored as `native_credit` evidence on the action
 * (`check.ts`), and reused while the transaction's block stays canonical, so
 * a later check doesn't depend on an endpoint still keeping that history.
 */
export const nativeCreditEvidenceSchema = z.strictObject({
  method: z.enum(["trace", "balance"]),
  /** The endpoint host that answered. */
  source: z.string().min(1).max(200),
  chainId: z.number().int().positive(),
  transactionHash: z.string().regex(/^0x[a-f\d]{64}$/),
  blockNumber: z.string().regex(/^\d+$/),
  blockHash: z.string().regex(/^0x[a-f\d]{64}$/),
  to: z.string().regex(/^0x[a-f\d]{40}$/),
  /** Trace: the sum of calls reaching `to`. Balance: the change across the block, which can be negative. */
  creditedRaw: z.string().regex(/^-?\d{1,80}$/),
  observedAt: z.string().datetime()
});
export type NativeCreditEvidence = z.infer<typeof nativeCreditEvidenceSchema>;

export type NativeCredit = { status: "observed"; evidence: NativeCreditEvidence } | { status: "unavailable"; reason: "native_credit_unavailable" };

export type NativeCreditTarget = { chainId: number; transactionHash: string; blockNumber: bigint; blockHash: string; to: string };

const MAX_FRAMES = 4_096;
const quantity = (value: unknown): bigint => {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Chain RPC returned an invalid quantity.");
  return BigInt(value);
};
const hex = (value: bigint) => `0x${value.toString(16)}`;

/** The value of every call in the tree that reached `to`, skipping any call that failed and everything under it. */
export function tracedCredit(root: unknown, to: string): bigint {
  let frames = 0;
  const walk = (frame: unknown): bigint => {
    if (++frames > MAX_FRAMES) throw new Error("Trace is too large.");
    if (!frame || typeof frame !== "object") throw new Error("Chain RPC returned a malformed trace.");
    const node = frame as { type?: unknown; to?: unknown; value?: unknown; error?: unknown; calls?: unknown };
    if (typeof node.type !== "string" || (node.calls !== undefined && !Array.isArray(node.calls))) throw new Error("Chain RPC returned a malformed trace.");
    // A failed call moved nothing, and neither did anything it called.
    if (node.error !== undefined && node.error !== null && node.error !== "") return 0n;
    const type = node.type.toUpperCase();
    // A delegate or static call carries no value of its own.
    const moves = type !== "DELEGATECALL" && type !== "STATICCALL" && typeof node.to === "string" && isAddress(node.to)
      && node.to.toLowerCase() === to.toLowerCase() && node.value !== undefined && node.value !== null;
    const own = moves ? quantity(node.value) : 0n;
    return ((node.calls as unknown[] | undefined) ?? []).reduce<bigint>((sum, child) => sum + walk(child), own);
  };
  return walk(root);
}

async function readTrace(fetcher: typeof fetch, endpoint: string, target: NativeCreditTarget): Promise<bigint> {
  const trace = await rpc(fetcher, endpoint, "debug_traceTransaction", [target.transactionHash, { tracer: "callTracer" }], 10_000);
  return tracedCredit(trace, target.to);
}

async function readBalanceChange(fetcher: typeof fetch, endpoint: string, target: NativeCreditTarget): Promise<bigint> {
  if (target.blockNumber < 1n) throw new Error("No block before the transaction.");
  const [before, after] = await Promise.all([
    rpc(fetcher, endpoint, "eth_getBalance", [target.to, hex(target.blockNumber - 1n)]),
    rpc(fetcher, endpoint, "eth_getBalance", [target.to, hex(target.blockNumber)])
  ]);
  // The endpoint must hold the same block, so its balances are the ones around this transaction.
  const block = await rpc(fetcher, endpoint, "eth_getBlockByNumber", [hex(target.blockNumber), false]) as { hash?: unknown } | null;
  if (!block || typeof block.hash !== "string" || block.hash.toLowerCase() !== target.blockHash.toLowerCase()) throw new Error("Chain RPC is on a different block.");
  return quantity(after) - quantity(before);
}

/**
 * How much native ETH the transaction's block brought the recipient, from
 * the first endpoint that can say: a trace where one is served, otherwise the
 * balance change. Unavailable when no endpoint can do either.
 */
export async function observeNativeCredit(target: NativeCreditTarget, options: { fetcher?: typeof fetch; now?: Date } = {}): Promise<NativeCredit> {
  const fetcher = options.fetcher ?? fetch;
  for (const endpoint of rpcEndpoints(target.chainId)) {
    try {
      if (quantity(await rpc(fetcher, endpoint, "eth_chainId", [])) !== BigInt(target.chainId)) continue;
    } catch { continue; }
    const observed = async (method: NativeCreditEvidence["method"], read: typeof readTrace): Promise<NativeCredit | null> => {
      try {
        const credited = await read(fetcher, endpoint, target);
        return { status: "observed", evidence: { method, source: new URL(endpoint).host, chainId: target.chainId,
          transactionHash: target.transactionHash.toLowerCase(), blockNumber: target.blockNumber.toString(), blockHash: target.blockHash.toLowerCase(),
          to: target.to.toLowerCase(), creditedRaw: credited.toString(), observedAt: (options.now ?? new Date()).toISOString() } };
      } catch { return null; }
    };
    const result = await observed("trace", readTrace) ?? await observed("balance", readBalanceChange);
    if (result) return result;
  }
  return { status: "unavailable", reason: "native_credit_unavailable" };
}

/** Earlier evidence for this exact transaction, chain, recipient, and block, if the block is still the canonical one. */
export function storedNativeCredit(evidence: readonly NativeCreditEvidence[] | undefined, target: NativeCreditTarget): NativeCreditEvidence | null {
  return evidence?.find((item) => item.chainId === target.chainId && item.transactionHash === target.transactionHash.toLowerCase()
    && item.blockHash === target.blockHash.toLowerCase() && item.to === target.to.toLowerCase()) ?? null;
}
