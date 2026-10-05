import { BASE_CHAIN_ID, networkName } from "@/lib/assets/registry";
import { LIFI_DIAMOND } from "@/lib/actions/lifi";
import { LifiStatusError, readLifiTransferStatus } from "@/lib/actions/lifi-status";
import { jsonRpc, rpcEndpoints } from "@/lib/chain/rpc";
import { formatUnits } from "@/lib/format/units";
import type { ActivityEntry } from "@/lib/activity/entries";

/**
 * Deposits bridged to the Aura account from a wallet the customer connected
 * on another network (`wallet_deposits`). The connected wallet signs these, not
 * Aura, so they aren't actions; this keeps one in Transactions while it's on
 * its way. A projection, never a balance: LI.FI reports progress, and once it
 * lands the transfer on Base is what Transactions shows.
 */
export type WalletDepositStatus = "pending" | "completed" | "refunded" | "failed";
export type WalletDeposit = {
  sourceHash: string; sourceChainId: number; fromAddress: string; tool: string; symbol: string; decimals: number;
  expectedAmountRaw: string; status: WalletDepositStatus; destinationHash: string | null; createdAt: string; observedAt: string;
};

type Row = { source_hash: string; source_chain_id: number; from_address: string; tool: string; symbol: string; decimals: number;
  expected_amount_raw: string; status: WalletDepositStatus; destination_hash: string | null; created_at: string; observed_at: string };

const RECHECK_MS = 30_000;
const MAX_CHECKS = 3;

export class DepositSourceError extends Error {
  constructor(readonly code: "source_not_found" | "source_mismatch") { super(code); this.name = "DepositSourceError"; }
}

type SourceTransaction = { from: string; to: string | null };

/**
 * The bridge's source transaction as the source network shows it: landed,
 * successful, and sent to the LI.FI Diamond. Returns who sent it, for the
 * caller to check is the customer's wallet.
 */
export async function readBridgeSource(chainId: number, hash: string, fetcher: typeof fetch = fetch): Promise<string> {
  let lastError: unknown;
  for (const endpoint of rpcEndpoints(chainId)) {
    try {
      const [transaction, receipt] = await Promise.all([
        jsonRpc<SourceTransaction | null>(fetcher, endpoint, "eth_getTransactionByHash", [hash]),
        jsonRpc<{ status: string } | null>(fetcher, endpoint, "eth_getTransactionReceipt", [hash])
      ]);
      if (!transaction || !receipt) throw new DepositSourceError("source_not_found");
      if (receipt.status !== "0x1" || transaction.to?.toLowerCase() !== LIFI_DIAMOND) throw new DepositSourceError("source_mismatch");
      return transaction.from.toLowerCase();
    } catch (error) {
      if (error instanceof DepositSourceError) throw error;
      lastError = error;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("No network endpoint answered.");
}

function fromRow(row: Row): WalletDeposit {
  return { sourceHash: row.source_hash, sourceChainId: row.source_chain_id, fromAddress: row.from_address, tool: row.tool, symbol: row.symbol,
    decimals: row.decimals, expectedAmountRaw: row.expected_amount_raw, status: row.status, destinationHash: row.destination_hash,
    createdAt: row.created_at, observedAt: row.observed_at };
}

/**
 * Keep a bridged deposit, once. Returns false when that source transaction is
 * already kept for another customer, which only happens if someone reports a
 * hash that isn't theirs.
 */
export async function recordWalletDeposit(db: D1Database, subject: string,
  deposit: Pick<WalletDeposit, "sourceHash" | "sourceChainId" | "fromAddress" | "tool" | "symbol" | "decimals" | "expectedAmountRaw">, now = new Date()): Promise<boolean> {
  const at = now.toISOString();
  const hash = deposit.sourceHash.toLowerCase();
  await db.prepare(`INSERT INTO wallet_deposits (source_hash, subject_reference, source_chain_id, from_address, tool, symbol, decimals, expected_amount_raw,
      status, destination_hash, source, created_at, observed_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending', NULL, 'LI.FI', ?9, ?9)
    ON CONFLICT (source_hash) DO NOTHING`)
    .bind(hash, subject, deposit.sourceChainId, deposit.fromAddress.toLowerCase(), deposit.tool, deposit.symbol, deposit.decimals, deposit.expectedAmountRaw, at).run();
  const owner = await db.prepare("SELECT subject_reference FROM wallet_deposits WHERE source_hash = ?").bind(hash).first<{ subject_reference: string }>();
  return owner?.subject_reference === subject;
}

/** What LI.FI reports, kept on the customer's deposit. A finished deposit doesn't change again. */
export async function updateWalletDeposit(db: D1Database, subject: string, sourceHash: string, lifiStatus: string, destinationHash: string | null, now = new Date()) {
  const status: WalletDepositStatus = lifiStatus === "DONE" || lifiStatus === "PARTIAL" ? "completed" : lifiStatus === "REFUNDED" ? "refunded"
    : lifiStatus === "FAILED" ? "failed" : "pending";
  await db.prepare(`UPDATE wallet_deposits SET status = ?1, destination_hash = COALESCE(?2, destination_hash), observed_at = ?3
    WHERE source_hash = ?4 AND subject_reference = ?5 AND status = 'pending'`)
    .bind(status, destinationHash?.toLowerCase() ?? null, now.toISOString(), sourceHash.toLowerCase(), subject).run();
}

/**
 * The customer's recent bridged deposits, after asking LI.FI about a few that
 * are still on their way, so they settle even if the customer left Deposit.
 */
export async function readWalletDeposits(db: D1Database, subject: string, now = new Date(),
  readStatus: typeof readLifiTransferStatus = readLifiTransferStatus): Promise<WalletDeposit[]> {
  const { results } = await db.prepare(`SELECT source_hash, source_chain_id, from_address, tool, symbol, decimals, expected_amount_raw, status,
      destination_hash, created_at, observed_at FROM wallet_deposits WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50`).bind(subject).all<Row>();
  const deposits = results.map(fromRow);
  const due = deposits.filter((deposit) => deposit.status === "pending" && now.getTime() - Date.parse(deposit.observedAt) >= RECHECK_MS).slice(0, MAX_CHECKS);
  await Promise.all(due.map(async (deposit) => {
    try {
      const status = await readStatus({ sourceHash: deposit.sourceHash, sourceChainId: deposit.sourceChainId, destinationChainId: BASE_CHAIN_ID, toolId: deposit.tool });
      await updateWalletDeposit(db, subject, deposit.sourceHash, status.status, status.destinationHash, now);
    } catch (error) {
      // LI.FI unreadable: the deposit stays pending and is asked about again next time.
      if (!(error instanceof LifiStatusError)) throw error;
    }
  }));
  if (!due.length) return deposits;
  const { results: fresh } = await db.prepare(`SELECT source_hash, source_chain_id, from_address, tool, symbol, decimals, expected_amount_raw, status,
      destination_hash, created_at, observed_at FROM wallet_deposits WHERE subject_reference = ? ORDER BY created_at DESC LIMIT 50`).bind(subject).all<Row>();
  return fresh.map(fromRow);
}

/** The deposit as a row in Transactions. Once it arrives, the transfer on Base takes its place (see `readHistory`). */
export function walletDepositEntry(deposit: WalletDeposit): ActivityEntry {
  const status = deposit.status === "pending" ? "pending" : deposit.status === "completed" ? "completed" : "failed";
  return { id: `deposit:${deposit.sourceHash}`, origin: "deposit", type: "received", status, final: false, createdAt: deposit.createdAt,
    chainId: deposit.sourceChainId, destinationChainId: BASE_CHAIN_ID, asset: deposit.symbol,
    amount: formatUnits(BigInt(deposit.expectedAmountRaw), deposit.decimals), counterparty: `Your wallet on ${networkName(deposit.sourceChainId)}`,
    transactionHash: deposit.sourceHash, destinationTransactionHash: deposit.destinationHash ?? undefined,
    failureReason: deposit.status === "refunded" ? "It couldn't reach Base, so it went back to your wallet" : deposit.status === "failed" ? "It didn't complete. Check your wallet's activity." : undefined,
    source: "LI.FI" };
}
