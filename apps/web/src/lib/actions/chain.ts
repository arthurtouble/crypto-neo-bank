import { getAddress, isAddress, isHex } from "viem";
import { BASE_CHAIN_ID } from "@/lib/assets/registry";
import { jsonRpc as rpc, rpcEndpoints } from "@/lib/chain/rpc";

/** The outer transaction as the chain reports it. For a smart wallet this is the bundler's EntryPoint call. */
type ObservedTransaction = { chainId: number; from: string; to: string; value: string; data: string };

type TransactionIdentityObservation =
  | { status: "pending" }
  | { status: "found"; call: ObservedTransaction; blockHash: string | null };

type ChainReceipt = {
  status: "success" | "reverted" | "unknown";
  transactionHash: string;
  blockHash: string;
  blockNumber: bigint;
  logs: Array<{ address: string; topics: string[]; data: string }>;
};

export type ChainObservation =
  | { status: "pending" }
  | { status: "found"; call: ObservedTransaction; blockHash: string | null; receipt: ChainReceipt | null; canonicalBlockHash: string | null; confirmations: number; finalizedBlockNumber: bigint | null };

function parseQuantity(value: unknown): bigint {
  if (typeof value !== "string" || !/^0x[0-9a-f]+$/i.test(value)) throw new Error("Chain RPC returned an invalid quantity.");
  return BigInt(value);
}

async function observeTransactionIdentity(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<TransactionIdentityObservation> {
  const endpoints = rpcEndpoints(chainId);
  if (!endpoints.length || !/^0x[a-f0-9]{64}$/i.test(hash)) throw new Error("Unsupported chain or transaction hash.");
  let pending = false;
  const failures: string[] = [];
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
    } catch (error) { failures.push(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : "failed"}`); }
  }
  if (pending) return { status: "pending" };
  throw new Error(`Transaction read failed on every endpoint (${failures.join("; ")}).`);
}

/** Observe transaction, receipt, and canonical block independently from the chain. */
export function requiredConfirmations(chainId: number): number {
  if (chainId === 1) return 12;
  if (chainId === 137) return 64;
  // Base orders blocks through one sequencer every 2 seconds; inclusion is enough to show a transfer as sent.
  // It is still confirmed only once the block is final.
  if (chainId === BASE_CHAIN_ID) return 1;
  return 3;
}

export async function observeTransaction(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<ChainObservation> {
  const identity = await observeTransactionIdentity(chainId, hash, fetcher);
  if (identity.status === "pending") return identity;
  const endpoints = rpcEndpoints(chainId);
  if (!endpoints.length) throw new Error("Unsupported chain.");
  // Public endpoints refuse some reads (publicnode treats receipts as archive requests), so try each in turn.
  const failures: string[] = [];
  for (const endpoint of endpoints) {
    try { return await observeReceipt(identity, chainId, hash, endpoint, fetcher); }
    catch (error) { failures.push(`${new URL(endpoint).host}: ${error instanceof Error ? error.message : "failed"}`); }
  }
  throw new Error(`Receipt read failed on every endpoint (${failures.join("; ")}).`);
}

/** Receipt, canonical block, confirmations, and finality from one endpoint, so the reads agree with each other. */
async function observeReceipt(identity: Extract<TransactionIdentityObservation, { status: "found" }>, chainId: number, hash: string,
  endpoint: string, fetcher: typeof fetch): Promise<ChainObservation> {
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
  const [latestBlock, finalized] = await Promise.all([rpc(fetcher, endpoint, "eth_blockNumber", []),
    rpc(fetcher, endpoint, "eth_getBlockByNumber", ["finalized", false])]);
  const latest = parseQuantity(latestBlock);
  const confirmations = latest >= blockNumber ? Number(latest - blockNumber + 1n) : 0;
  const finalizedBlockNumber = finalized && typeof finalized === "object" && "number" in finalized
    ? parseQuantity((finalized as { number: unknown }).number) : null;
  const status = row.status === "0x1" ? "success" : row.status === "0x0" ? "reverted" : "unknown";
  return { ...identity, receipt: { status, transactionHash: row.transactionHash, blockHash: row.blockHash, blockNumber, logs }, canonicalBlockHash, confirmations, finalizedBlockNumber };
}
