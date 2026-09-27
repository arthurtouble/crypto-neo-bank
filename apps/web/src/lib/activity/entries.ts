import { formatUnits } from "viem";
import type { IncomingTransfer } from "./incoming";

/**
 * One row in Transactions, whatever it came from: an Aura action (verified
 * against the chain), money that arrived without one (Alchemy's transfer
 * index), or Aave history (Aave's data service). Shared by the list, the
 * receipt, exports, statements, and Insights, so they always agree.
 */
export type EntryType = "sent" | "received" | "swap" | "bridge" | "earn_deposit" | "earn_withdraw"
  | "borrow" | "repay" | "liquidation" | "collateral_enabled" | "collateral_disabled" | "defi_activity";
export type EntryStatus = "pending" | "completed" | "failed" | "not_confirmed";
export type EntryOrigin = "aura" | "incoming" | "aave";

export type ActivityEntry = {
  id: string;
  origin: EntryOrigin;
  type: EntryType;
  status: EntryStatus;
  createdAt: string;
  chainId: number;
  asset?: string;
  amount?: string;
  /** For a swap or a move between networks: what arrives. */
  toAsset?: string;
  toAmount?: string;
  /** Who the money went to or came from. Absent when it stays in the account. */
  counterparty?: string;
  /** US dollar value: at preparation for Aura actions, when read for incoming transfers. */
  estimatedUsd?: number;
  transactionHash?: string;
  destinationChainId?: number;
  destinationTransactionHash?: string;
  failureReason?: string;
  source: string;
};

/** The fields of a stored action (or its browser view) an entry needs. */
export type ActionLike = { id: string; kind: "transfer" | "earn" | "route"; chainId: number; status: string; summary: Record<string, unknown>;
  usdCents: number | null; transactionHash: string | null; destinationChainId: number | null; destinationTransactionHash: string | null;
  failureReason: string | null; createdAt: string };

type RouteSide = { symbol?: string; decimals?: number };
const raw = (value: unknown, decimals: unknown) => typeof value === "string" && /^\d+$/.test(value) && typeof decimals === "number" ? formatUnits(BigInt(value), decimals) : undefined;

export function entryStatus(status: string): EntryStatus {
  if (status === "confirmed") return "completed";
  if (status === "failed") return "failed";
  if (status === "expired") return "not_confirmed";
  return "pending";
}

export function actionEntry(action: ActionLike): ActivityEntry {
  const summary = action.summary;
  const base = { id: action.id, origin: "aura" as const, status: entryStatus(action.status), createdAt: action.createdAt, chainId: action.chainId,
    estimatedUsd: action.usdCents === null ? undefined : action.usdCents / 100, transactionHash: action.transactionHash ?? undefined,
    failureReason: action.failureReason ?? undefined, source: "Aura" };
  if (action.kind === "route") {
    const from = summary.from as RouteSide | undefined;
    const to = summary.to as RouteSide | undefined;
    const recipient = typeof summary.recipient === "string" ? summary.recipient : undefined;
    // A route to someone else is a send (lib/actions/route.ts marks it `external`); to the account itself, a swap or a move.
    const external = summary.external === true;
    return { ...base, type: external ? "sent" : action.destinationChainId ? "bridge" : "swap",
      asset: from?.symbol, amount: raw(summary.fromAmountRaw, from?.decimals), toAsset: to?.symbol, toAmount: raw(summary.toAmountRaw, to?.decimals),
      counterparty: external ? recipient : undefined, destinationChainId: action.destinationChainId ?? undefined,
      destinationTransactionHash: action.destinationTransactionHash ?? undefined };
  }
  const symbol = typeof summary.symbol === "string" ? summary.symbol : undefined;
  // "Withdraw all" records what the shares were worth when it was prepared.
  const amount = summary.amount === "all" ? raw(summary.amountRaw, summary.decimals) : typeof summary.amount === "string" ? summary.amount : undefined;
  if (action.kind === "earn") {
    const place = typeof summary.vaultName === "string" ? summary.vaultName : summary.protocol === "aave" ? "Aave" : undefined;
    return { ...base, type: summary.direction === "withdraw" ? "earn_withdraw" : "earn_deposit", asset: symbol, amount, counterparty: place };
  }
  const bank = summary.bankPayout as { bankName?: string; lastFour?: string } | undefined;
  return { ...base, type: "sent", asset: symbol, amount,
    counterparty: bank ? [bank.bankName ?? "Bank account", bank.lastFour ? `ending ${bank.lastFour}` : ""].join(" ").trim() : typeof summary.to === "string" ? summary.to : undefined };
}

export function incomingEntry(transfer: IncomingTransfer, usdCentsPerUnit?: number | null): ActivityEntry {
  const value = usdCentsPerUnit === undefined || usdCentsPerUnit === null ? undefined
    : Math.round(Number(BigInt(transfer.amountRaw) * BigInt(usdCentsPerUnit) / 10n ** BigInt(transfer.decimals))) / 100;
  return { id: transfer.id, origin: "incoming", type: "received", status: transfer.status, createdAt: transfer.receivedAt, chainId: transfer.chainId,
    asset: transfer.symbol, amount: transfer.amount, counterparty: transfer.from, estimatedUsd: value, transactionHash: transfer.transactionHash,
    source: transfer.source };
}

const LABELS: Record<EntryType, string> = {
  sent: "Sent", received: "Received", swap: "Swapped", bridge: "Moved between networks", earn_deposit: "Added to Earn",
  earn_withdraw: "Withdrawn from Earn", borrow: "Borrowed", repay: "Repaid", liquidation: "Collateral liquidated",
  collateral_enabled: "Enabled collateral", collateral_disabled: "Disabled collateral", defi_activity: "Aave activity"
};
export const entryLabel = (type: EntryType) => LABELS[type];

export const CATEGORIES = ["All", "Sent", "Received", "Swaps", "Earn", "Other"] as const;
export type EntryCategory = Exclude<(typeof CATEGORIES)[number], "All">;
export function entryCategory(type: EntryType): EntryCategory {
  if (type === "sent") return "Sent";
  if (type === "received") return "Received";
  if (type === "swap" || type === "bridge") return "Swaps";
  if (type === "earn_deposit" || type === "earn_withdraw" || type.startsWith("collateral_")) return "Earn";
  return "Other";
}

const STATUS_LABELS: Record<EntryStatus, string> = { pending: "Pending", completed: "Completed", failed: "Failed", not_confirmed: "Not confirmed" };
export const STATUSES = ["All", ...Object.values(STATUS_LABELS)] as const;
export const statusLabel = (status: EntryStatus) => STATUS_LABELS[status];

/** "2 USDC", or "2 USDC for 0.0058 AAPLc" for a swap. */
export function entryAmount(entry: ActivityEntry) {
  if (!entry.amount) return undefined;
  const paid = `${entry.amount} ${entry.asset ?? ""}`.trim();
  return entry.toAmount && entry.toAsset && (entry.type === "swap" || entry.type === "bridge") ? `${paid} for ${entry.toAmount} ${entry.toAsset}` : paid;
}

/** Money in, money out, or moved within the account, for Insights. */
export function entryDirection(type: EntryType): "in" | "out" | "earn" | "moved" | "other" {
  if (type === "received" || type === "borrow") return "in";
  if (type === "sent" || type === "repay") return "out";
  if (type === "earn_deposit") return "earn";
  if (type === "swap" || type === "bridge") return "moved";
  return "other";
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  // Guard spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export const CSV_COLUMNS = ["Date", "Description", "Status", "Amount", "Asset", "Received amount", "Received asset", "Counterparty", "Estimated USD",
  "Network", "Transaction", "Source"] as const;

/** Every export and statement uses these columns, one row per entry. */
export function entriesCsv(entries: ActivityEntry[], networkName: (chainId: number) => string, extra?: { header: string[]; row: (entry: ActivityEntry) => Array<string | number | undefined> }) {
  const header = [...CSV_COLUMNS, ...(extra?.header ?? [])];
  const rows = entries.map((entry) => [entry.createdAt, entryLabel(entry.type), statusLabel(entry.status), entry.amount, entry.asset,
    entry.toAmount, entry.toAsset, entry.counterparty, entry.estimatedUsd?.toFixed(2), networkName(entry.chainId), entry.transactionHash, entry.source,
    ...(extra?.row(entry) ?? [])]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
