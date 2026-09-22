import { getAddress, isAddress, isHex } from "viem";
import type { PreparedCallInput } from "./evidence";

const RPC_BY_CHAIN: Record<number, readonly string[]> = {
  1: ["https://ethereum-rpc.publicnode.com"],
  10: ["https://mainnet.optimism.io"],
  137: ["https://polygon-bor-rpc.publicnode.com"],
  8453: ["https://base-rpc.publicnode.com", "https://mainnet.base.org"],
  42161: ["https://arb1.arbitrum.io/rpc"]
};

export type TransactionIdentityObservation =
  | { status: "pending" }
  | { status: "found"; call: PreparedCallInput; blockHash: string | null };

export type ChainReceipt = {
  status: "success" | "reverted" | "unknown";
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

export type ChainObservation =
  | { status: "pending" }
  | { status: "found"; call: PreparedCallInput; blockHash: string | null; receipt: ChainReceipt | null; canonicalBlockHash: string | null; confirmations: number; finalizedBlockNumber: bigint | null };

async function rpc(fetcher: typeof fetch, endpoint: string, method: string, params: unknown[]) {
  const response = await fetcher(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    signal: AbortSignal.timeout(8_000)
  });
  if (!response.ok) throw new Error(`Chain RPC returned ${response.status}.`);
  const payload = await response.json() as { result?: unknown; error?: { message?: string } };
  if (payload.error || !("result" in payload)) throw new Error("Chain RPC returned an error.");
  return payload.result;
}

function parseQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Chain RPC returned an invalid quantity.");
  return BigInt(value);
}

export async function observeTransactionIdentity(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<TransactionIdentityObservation> {
  const endpoints = RPC_BY_CHAIN[chainId];
  if (!endpoints || !/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error("Unsupported chain or transaction hash.");
  let pending = false;
  let lastError: Error | null = null;
  for (const endpoint of endpoints) {
    try {
      const observedChain = parseQuantity(await rpc(fetcher, endpoint, "eth_chainId", []));
      if (observedChain !== BigInt(chainId)) throw new Error("Chain RPC returned the wrong chain.");
      const transaction = await rpc(fetcher, endpoint, "eth_getTransactionByHash", [hash]);
      if (transaction === null) { pending = true; continue; }
      if (!transaction || typeof transaction !== "object") throw new Error("Chain RPC returned a malformed transaction.");
      const tx = transaction as Record<string, unknown>;
      if (typeof tx.hash !== "string" || tx.hash.toLowerCase() !== hash.toLowerCase()) throw new Error("Chain RPC returned the wrong transaction hash.");
      if (typeof tx.from !== "string" || typeof tx.to !== "string" || typeof tx.input !== "string" || !isAddress(tx.from) || !isAddress(tx.to) || !isHex(tx.input, { strict: true }) || tx.input.length % 2 !== 0) throw new Error("Chain RPC returned a malformed transaction.");
      if (tx.chainId != null && parseQuantity(tx.chainId) !== BigInt(chainId)) throw new Error("Chain transaction used the wrong chain.");
      if (tx.blockHash != null && (typeof tx.blockHash !== "string" || !/^0x[a-f0-9]{64}$/i.test(tx.blockHash))) throw new Error("Chain RPC returned a malformed block hash.");
      return { status: "found", call: { chainId, from: getAddress(tx.from), to: getAddress(tx.to), value: parseQuantity(tx.value).toString(), data: tx.input }, blockHash: tx.blockHash as string | null };
    } catch (error) { lastError = error instanceof Error ? error : new Error("Chain observation failed."); }
  }
  if (pending) return { status: "pending" };
  throw lastError ?? new Error("Chain observation failed.");
}

/** Observe transaction, receipt, and canonical block independently from the chain. */
export async function observeTransaction(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<ChainObservation> {
  const identity = await observeTransactionIdentity(chainId, hash, fetcher);
  if (identity.status === "pending") return identity;
  const endpoint = RPC_BY_CHAIN[chainId]?.[0];
  if (!endpoint) throw new Error("Unsupported chain.");
  if (parseQuantity(await rpc(fetcher, endpoint, "eth_chainId", [])) !== BigInt(chainId)) throw new Error("Receipt RPC returned the wrong chain.");
  const rawReceipt = await rpc(fetcher, endpoint, "eth_getTransactionReceipt", [hash]);
  if (rawReceipt === null) return { ...identity, receipt: null, canonicalBlockHash: null, confirmations: 0, finalizedBlockNumber: null };
  if (!rawReceipt || typeof rawReceipt !== "object") throw new Error("Chain RPC returned a malformed receipt.");
  const row = rawReceipt as Record<string, unknown>;
  if (typeof row.transactionHash !== "string" || typeof row.blockHash !== "string" || !/^0x[a-f0-9]{64}$/i.test(row.transactionHash) || !/^0x[a-f0-9]{64}$/i.test(row.blockHash) || !Array.isArray(row.logs)) throw new Error("Chain RPC returned a malformed receipt.");
  const blockNumber = parseQuantity(row.blockNumber);
  const logs = row.logs.map((item: unknown) => {
    if (!item || typeof item !== "object") throw new Error("Chain RPC returned a malformed log.");
    const log = item as Record<string, unknown>;
    if (typeof log.address !== "string" || !isAddress(log.address) || !Array.isArray(log.topics) || !log.topics.every((topic) => typeof topic === "string" && /^0x[a-f0-9]{64}$/i.test(topic)) || typeof log.data !== "string" || !isHex(log.data, { strict: true })) throw new Error("Chain RPC returned a malformed log.");
    return { address: log.address, topics: log.topics as string[], data: log.data };
  });
  const rawBlock = await rpc(fetcher, endpoint, "eth_getBlockByNumber", [`0x${blockNumber.toString(16)}`, false]);
  const canonicalBlockHash = rawBlock && typeof rawBlock === "object" && typeof (rawBlock as Record<string, unknown>).hash === "string" ? (rawBlock as { hash: string }).hash : null;
  if (canonicalBlockHash && !/^0x[a-f0-9]{64}$/i.test(canonicalBlockHash)) throw new Error("Chain RPC returned a malformed block.");
  const latest = parseQuantity(await rpc(fetcher, endpoint, "eth_blockNumber", []));
  const confirmations = latest >= blockNumber ? Number(latest - blockNumber + 1n) : 0;
  const finalized = await rpc(fetcher, endpoint, "eth_getBlockByNumber", ["finalized", false]);
  const finalizedBlockNumber = finalized && typeof finalized === "object" && "number" in finalized
    ? parseQuantity((finalized as { number: unknown }).number) : null;
  const status = row.status === "0x1" ? "success" : row.status === "0x0" ? "reverted" : "unknown";
  return { ...identity, receipt: { status, transactionHash: row.transactionHash, blockHash: row.blockHash, blockNumber, logs }, canonicalBlockHash, confirmations, finalizedBlockNumber };
}
