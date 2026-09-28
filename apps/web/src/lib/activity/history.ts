import { checkAction } from "@/lib/actions/check";
import { listActions, listActionsBetween, listActionHashes, type StoredAction } from "@/lib/actions/store";
import { valueAsset } from "@/lib/actions/valuation";
import { getAaveBaseActivity, type AaveBaseActivity } from "@/lib/defi/aave";
import { readCardHistory, type CardHistory } from "@/lib/cards/service";
import { actionEntry, cardEntry, incomingEntry, type ActivityEntry } from "./entries";
import { readIncoming, type IncomingRead } from "./incoming";
import { recordIncoming } from "./observations";
import { readBankDeposits, refreshBankPayouts } from "@/lib/money/bank-activity";
import type { BankDeposit } from "@/lib/providers/bridge/transfers";

const RECHECK_MS = 30_000;
const MAX_CHECKS = 3;
export const MAX_ENTRIES = 150;

export type SourceState = { status: "available" | "unavailable"; partial: boolean };
export type History = { entries: ActivityEntry[]; sources: { aura: SourceState; incoming: SourceState; aave: SourceState; card: SourceState }; observedAt: string };

type Deps = { bankDeposits?: (subject: string) => Promise<Map<string, BankDeposit>>; refreshPayouts?: (subject: string) => Promise<unknown>;
  readIncoming?: typeof readIncoming; aave?: (wallet: string) => Promise<AaveBaseActivity>; check?: typeof checkAction;
  unitCents?: (assetId: string, decimals: number) => Promise<number | null>;
  cards?: (subject: string, window: { since?: Date; until?: Date }) => Promise<CardHistory> };

const cardReader = (db: D1Database, deps: Deps, now: Date) => deps.cards ?? ((subject: string, window: { since?: Date; until?: Date }) => readCardHistory(db, subject, window, now));

/** What one whole unit of an asset is worth now, in cents, read once per asset per request. */
function unitPricer(deps: Deps) {
  const cache = new Map<string, Promise<number | null>>();
  return (assetId: string, decimals: number) => {
    if (!cache.has(assetId)) cache.set(assetId, deps.unitCents ? deps.unitCents(assetId, decimals)
      : valueAsset({ assetId, amountRaw: (10n ** BigInt(decimals)).toString(), decimals }).then((value) => value.usdCents).catch(() => null));
    return cache.get(assetId)!;
  };
}

async function incomingEntries(read: IncomingRead, deps: Deps, bank: Map<string, BankDeposit>) {
  const price = unitPricer(deps);
  return Promise.all(read.transfers.map(async (transfer) => incomingEntry(transfer, await price(transfer.assetId, transfer.decimals),
    bank.get(transfer.transactionHash.toLowerCase()))));
}

/**
 * The customer's recent activity, newest first: their Aura actions (a few
 * open ones re-checked against the chain on the way), money that arrived
 * without an action, card payments (Stripe), and Aave history. Each source reports whether it could
 * be read, so a failed read never looks like "nothing happened".
 */
export async function readHistory(db: D1Database, subject: string, wallet: string, now = new Date(), deps: Deps = {}): Promise<History> {
  // Pick up a few bank payouts' latest state from Bridge first, in case a webhook is late.
  await (deps.refreshPayouts ?? ((who: string) => refreshBankPayouts(db, { subject: who, limit: 3, now })))(subject).catch(() => undefined);
  const [stored, hashes] = await Promise.all([listActions(db, subject, 100), listActionHashes(db, subject)]);
  const [incoming, aave, bank, cards] = await Promise.all([
    (deps.readIncoming ?? readIncoming)(wallet, { exclude: hashes, now }),
    (deps.aave ?? getAaveBaseActivity)(wallet).catch((): AaveBaseActivity => ({ items: [], partial: false, sourceStatus: "unavailable" })),
    (deps.bankDeposits ?? ((who: string) => readBankDeposits(db, who)))(subject),
    cardReader(db, deps, now)(subject, {})
  ]);
  await recordIncoming(db, subject, wallet, incoming.transfers, now);
  // Opening Transactions also advances a few open actions, so they settle even if the customer left the screen they started on.
  const due = stored.filter((action) => (action.status === "submitted" || action.status === "settling") && (action.transactionHash || action.relayReference)
    && (!action.checkedAt || now.getTime() - Date.parse(action.checkedAt) >= RECHECK_MS)).slice(0, MAX_CHECKS);
  const checked = new Map<string, StoredAction>(await Promise.all(due.map(async (action) =>
    [action.id, await (deps.check ?? checkAction)(db, action, now)] as const)));
  const own = stored.map((action) => actionEntry(checked.get(action.id) ?? action));
  const hashSet = new Set(hashes);
  const aaveEntries: ActivityEntry[] = aave.items.filter((item) => !hashSet.has(item.transactionHash.toLowerCase())).map((item) => ({
    id: item.id, origin: "aave", type: item.type === "earn_supply" ? "earn_deposit" : item.type, status: "completed", createdAt: item.createdAt,
    chainId: item.chainId, asset: item.asset, amount: item.amount, estimatedUsd: item.estimatedUsd, counterparty: "Aave", transactionHash: item.transactionHash,
    source: "Aave"
  }));
  const entries = [...own, ...await incomingEntries(incoming, deps, bank), ...aaveEntries, ...cards.items.map(cardEntry)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, MAX_ENTRIES);
  return { entries, observedAt: now.toISOString(), sources: {
    aura: { status: "available", partial: stored.length >= 100 },
    incoming: { status: incoming.status, partial: incoming.partial },
    aave: { status: aave.sourceStatus === "unavailable" ? "unavailable" : "available", partial: aave.partial },
    card: { status: cards.status, partial: cards.partial }
  } };
}

/**
 * Everything in [start, end), oldest first, for a statement or Insights. It is
 * complete or it is refused: if incoming transfers or card payments can't all
 * be read, the result says which, instead of undercounting.
 */
export async function readPeriod(db: D1Database, subject: string, wallet: string, start: Date, end: Date, deps: Deps = {}) {
  const [actions, hashes] = await Promise.all([listActionsBetween(db, subject, start, end), listActionHashes(db, subject)]);
  const [incoming, bank, cards] = await Promise.all([(deps.readIncoming ?? readIncoming)(wallet, { exclude: hashes, since: start, until: end }),
    (deps.bankDeposits ?? ((who: string) => readBankDeposits(db, who)))(subject), cardReader(db, deps, end)(subject, { since: start, until: end })]);
  const incomingComplete = incoming.status === "available" && !incoming.partial;
  const cardComplete = cards.status === "available" && !cards.partial;
  const inPeriod = (entry: ActivityEntry) => Date.parse(entry.createdAt) >= start.getTime() && Date.parse(entry.createdAt) < end.getTime();
  const entries = [...actions.map(actionEntry), ...await incomingEntries(incoming, deps, bank), ...cards.items.map(cardEntry).filter(inPeriod)]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { entries, complete: incomingComplete && cardComplete, incomingComplete, cardComplete };
}
