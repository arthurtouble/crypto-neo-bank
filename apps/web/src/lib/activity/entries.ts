import { formatUnits } from "@/lib/format/units";
import { BASE_CHAIN_ID } from "@/lib/assets/registry";
import type { CardActivity } from "@/lib/cards/service";
import { FAILED_PAYOUT_STATES, payoutStateText } from "@/lib/providers/bridge/transfers";
import type { IncomingTransfer } from "./incoming";

/**
 * One row in Transactions, whatever it came from: an Aura action (verified
 * against the chain), money that arrived without one (Alchemy's transfer
 * index), a deposit bridged from the customer's own wallet while it's on its
 * way (LI.FI), or Aave history (Aave's data service). Shared by the list, the
 * receipt, exports, statements, and Insights, so they always agree. Card
 * payments come from Stripe, which issues the card.
 */
type EntryType = "sent" | "received" | "bank_deposit" | "bank_payout" | "card_payment" | "card_refund" | "card_allowance" | "card_spending_off" | "swap" | "bridge" | "earn_deposit" | "earn_withdraw"
  | "borrow" | "repay" | "liquidation" | "collateral_enabled" | "collateral_disabled" | "defi_activity"
  | "perps_deposit" | "perps_withdraw" | "predictions_deposit" | "predictions_withdraw";
type EntryStatus = "pending" | "completed" | "failed" | "not_confirmed";
type EntryOrigin = "aura" | "incoming" | "aave" | "card" | "deposit";

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
  /** Completed and in a final block. A completed entry that isn't final yet can, very rarely, still be reversed. */
  final?: boolean;
  /** A bank payout's progress at Bridge, in words. */
  bankStatus?: string;
  /** A disputed card payment's dispute status at Stripe. */
  cardDispute?: string;
  source: string;
};

/** The fields of a stored action (or its browser view) an entry needs. */
type ActionLike = { id: string; kind: "transfer" | "earn" | "route"; chainId: number; status: string; summary: Record<string, unknown>;
  usdCents: number | null; transactionHash: string | null; destinationChainId: number | null; destinationTransactionHash: string | null;
  failureReason: string | null; createdAt: string; bankState?: string | null };

const MARKET_NAMES = { perps: "Hyperliquid", predictions: "Polymarket" } as const;

type RouteSide = { symbol?: string; decimals?: number };
const raw = (value: unknown, decimals: unknown) => typeof value === "string" && /^\d+$/.test(value) && typeof decimals === "number" ? formatUnits(BigInt(value), decimals) : undefined;

/**
 * An action's status as customers see it. Like mainstream wallets, a
 * same-network action is completed once it is in a block and fully matches
 * what was prepared (`settling`); `confirmed` adds that its block is final.
 * A move to another network stays pending until it arrives.
 */
function entryStatus(status: string, crossNetwork = false): { status: EntryStatus; final: boolean } {
  if (status === "confirmed") return { status: "completed", final: true };
  if (status === "settling" && !crossNetwork) return { status: "completed", final: false };
  if (status === "failed") return { status: "failed", final: false };
  if (status === "expired") return { status: "not_confirmed", final: false };
  return { status: "pending", final: false };
}

export function actionEntry(action: ActionLike): ActivityEntry {
  const summary = action.summary;
  const base = { id: action.id, origin: "aura" as const, ...entryStatus(action.status, action.destinationChainId !== null), createdAt: action.createdAt, chainId: action.chainId,
    estimatedUsd: action.usdCents === null ? undefined : action.usdCents / 100, transactionHash: action.transactionHash ?? undefined,
    failureReason: action.failureReason ?? undefined, source: "Aura" };
  // Money moved between the account and its own perps (Hyperliquid) or predictions (Polymarket) account.
  const market = summary.market === "hyperliquid" ? "perps" : summary.market === "polymarket" ? "predictions" : null;
  if (market) {
    const from = summary.from as RouteSide | undefined;
    const amount = action.kind === "route" ? raw(summary.fromAmountRaw, from?.decimals) : typeof summary.amount === "string" ? summary.amount : undefined;
    return { ...base, type: `${market}_deposit`, asset: action.kind === "route" ? from?.symbol : typeof summary.symbol === "string" ? summary.symbol : undefined,
      amount, counterparty: MARKET_NAMES[market] };
  }
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
  // "Withdraw all" records what the position was worth when it was prepared.
  const amount = summary.amount === "all" ? raw(summary.amountRaw, summary.decimals) : typeof summary.amount === "string" ? summary.amount : undefined;
  if (action.kind === "earn") {
    const place = typeof summary.vaultName === "string" ? summary.vaultName : summary.protocol === "aave" ? "Aave" : undefined;
    return { ...base, type: summary.direction === "withdraw" ? "earn_withdraw" : "earn_deposit", asset: symbol, amount, counterparty: place };
  }
  const bank = summary.bankPayout as { bankName?: string; lastFour?: string } | undefined;
  if (bank) {
    // Funding the payout on Base is only half of it: it's complete when Bridge says the bank has it.
    const state = action.bankState ?? null;
    const chainDone = base.status === "completed";
    const status: EntryStatus = base.status === "failed" || base.status === "not_confirmed" ? base.status
      : state && FAILED_PAYOUT_STATES.has(state) ? "failed" : chainDone && state === "payment_processed" ? "completed" : "pending";
    return { ...base, type: "bank_payout", status, final: status === "completed" && base.final, asset: symbol, amount,
      counterparty: [bank.bankName ?? "Bank account", bank.lastFour ? `ending ${bank.lastFour}` : ""].join(" ").trim(),
      bankStatus: chainDone ? payoutStateText(state ?? "awaiting_funds") : undefined };
  }
  // Approving the card to spend moves nothing; each purchase does, later.
  if (summary.cardAllowance) {
    const off = (summary.cardAllowance as { off?: unknown }).off === true;
    return { ...base, type: off ? "card_spending_off" : "card_allowance", asset: symbol, amount, counterparty: "Aura card", estimatedUsd: undefined };
  }
  return { ...base, type: "sent", asset: symbol, amount, counterparty: typeof summary.to === "string" ? summary.to : undefined };
}

/**
 * A card payment, hold, decline, or refund. Bridge takes each purchase from
 * the account's USDC on Base, one US dollar for one USDC, so its value is the
 * card amount. A declined or reversed hold moved no money.
 */
export function cardEntry(item: CardActivity): ActivityEntry {
  const status: EntryStatus = item.status === "completed" ? "completed" : item.status === "pending" ? "pending" : "failed";
  return { id: `card:${item.id}`, origin: "card", type: item.kind === "refund" ? "card_refund" : "card_payment", status, final: status === "completed",
    createdAt: item.createdAt, chainId: BASE_CHAIN_ID, asset: "USD", amount: item.amountUsd, counterparty: item.merchant ?? "Card payment",
    estimatedUsd: status === "failed" ? undefined : Number(item.amountUsd), transactionHash: item.transactionHash ?? undefined,
    failureReason: item.status === "declined" ? "Declined" : item.status === "reversed" ? "Hold released" : undefined,
    cardDispute: item.dispute?.status, source: "Stripe" };
}

/**
 * An incoming transfer that is the customer's own withdrawal from perps or
 * predictions arriving (see `lib/activity/markets.ts`).
 */
export function marketWithdrawalEntry(entry: ActivityEntry, market: "perps" | "predictions"): ActivityEntry {
  return { ...entry, type: `${market}_withdraw`, counterparty: MARKET_NAMES[market], source: `${entry.source} · ${MARKET_NAMES[market]}` };
}

export function incomingEntry(transfer: IncomingTransfer, usdCentsPerUnit?: number | null, bank?: { senderName: string | null; bankName: string | null }): ActivityEntry {
  const value = usdCentsPerUnit === undefined || usdCentsPerUnit === null ? undefined
    : Math.round(Number(BigInt(transfer.amountRaw) * BigInt(usdCentsPerUnit) / 10n ** BigInt(transfer.decimals))) / 100;
  return { id: transfer.id, origin: "incoming", type: bank ? "bank_deposit" : "received", status: transfer.status, final: transfer.final, createdAt: transfer.receivedAt,
    chainId: transfer.chainId, asset: transfer.symbol, amount: transfer.amount,
    // A bank deposit comes from Bridge's address; who sent it is the bank sender.
    counterparty: bank ? bank.senderName ?? bank.bankName ?? "Bank transfer" : transfer.from, estimatedUsd: value, transactionHash: transfer.transactionHash,
    source: bank ? `${transfer.source} · Bridge` : transfer.source };
}

const LABELS: Record<EntryType, string> = {
  sent: "Sent", received: "Received", bank_deposit: "Bank deposit", bank_payout: "Sent to bank", card_payment: "Card payment", card_refund: "Card refund", card_allowance: "Card allowance set", card_spending_off: "Card spending turned off", swap: "Swapped", bridge: "Moved between networks", earn_deposit: "Added to Earn",
  earn_withdraw: "Withdrawn from Earn", borrow: "Borrowed", repay: "Repaid", liquidation: "Collateral liquidated",
  collateral_enabled: "Enabled collateral", collateral_disabled: "Disabled collateral", defi_activity: "Aave activity",
  perps_deposit: "Added to perps", perps_withdraw: "Withdrawn from perps", predictions_deposit: "Added to predictions", predictions_withdraw: "Withdrawn from predictions"
};
export const entryLabel = (type: EntryType) => LABELS[type];

/** The most entries Transactions lists at once, newest first. */
export const HISTORY_LIMIT = 150;

export const CATEGORIES = ["All", "Sent", "Received", "Card", "Swaps", "Earn", "Markets", "Other"] as const;
type EntryCategory = Exclude<(typeof CATEGORIES)[number], "All">;
export function entryCategory(type: EntryType): EntryCategory {
  if (type === "card_payment" || type === "card_refund" || type === "card_allowance" || type === "card_spending_off") return "Card";
  if (type === "sent" || type === "bank_payout") return "Sent";
  if (type === "received" || type === "bank_deposit") return "Received";
  if (type === "swap" || type === "bridge") return "Swaps";
  if (type === "earn_deposit" || type === "earn_withdraw" || type.startsWith("collateral_")) return "Earn";
  if (type.startsWith("perps_") || type.startsWith("predictions_")) return "Markets";
  return "Other";
}

const STATUS_LABELS: Record<EntryStatus, string> = { pending: "Pending", completed: "Completed", failed: "Failed", not_confirmed: "Not sent" };
export const STATUSES = ["All", ...Object.values(STATUS_LABELS)] as const;
export const statusLabel = (status: EntryStatus) => STATUS_LABELS[status];

/** "2 USDC", or "2 USDC for 0.0058 AAPLc" for a swap. */
export function entryAmount(entry: ActivityEntry) {
  if (!entry.amount) return undefined;
  const paid = `${entry.amount} ${entry.asset ?? ""}`.trim();
  return entry.toAmount && entry.toAsset && (entry.type === "swap" || entry.type === "bridge") ? `${paid} for ${entry.toAmount} ${entry.toAsset}` : paid;
}

/** Money in, money out, or moved within the account, for Insights. Borrowing and repaying aren't income or spending. */
export function entryDirection(type: EntryType): "in" | "out" | "earn" | "moved" | "other" {
  if (type === "received" || type === "bank_deposit" || type === "card_refund") return "in";
  if (type === "sent" || type === "bank_payout" || type === "card_payment") return "out";
  if (type === "earn_deposit") return "earn";
  // Moving money to or from the account's own perps or predictions account is neither income nor spending.
  if (type === "swap" || type === "bridge" || type.startsWith("perps_") || type.startsWith("predictions_")) return "moved";
  return "other";
}

function csvCell(value: string | number | undefined) {
  const text = String(value ?? "");
  // Guard spreadsheet formula injection as well as quoting.
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

const CSV_COLUMNS = ["Date", "Description", "Status", "Amount", "Asset", "Received amount", "Received asset", "Counterparty", "Estimated USD",
  "Network", "Transaction", "Final", "Source"] as const;

/** Every export and statement uses these columns, one row per entry. */
export function entriesCsv(entries: ActivityEntry[], networkName: (chainId: number) => string, extra?: { header: string[]; row: (entry: ActivityEntry) => Array<string | number | undefined> }) {
  const header = [...CSV_COLUMNS, ...(extra?.header ?? [])];
  const rows = entries.map((entry) => [entry.createdAt, entryLabel(entry.type), statusLabel(entry.status), entry.amount, entry.asset,
    entry.toAmount, entry.toAsset, entry.counterparty, entry.estimatedUsd?.toFixed(2), networkName(entry.chainId), entry.transactionHash,
    entry.status === "completed" ? (entry.final ? "Yes" : "Not yet") : "", entry.source,
    ...(extra?.row(entry) ?? [])]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\n") + "\n";
}
