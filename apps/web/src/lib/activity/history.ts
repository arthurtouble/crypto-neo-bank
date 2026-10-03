import { checkAction } from "@/lib/actions/check";
import { listActions, listActionsBefore, listActionsBetween, listActionHashes, type StoredAction } from "@/lib/actions/store";
import { valueAsset } from "@/lib/actions/valuation";
import { getAaveBaseActivity, type AaveBaseActivity } from "@/lib/defi/aave";
import { readCardHistory, type CardHistory } from "@/lib/cards/service";
import { actionEntry, cardEntry, HISTORY_LIMIT, incomingEntry, type ActivityEntry } from "./entries";
import { readIncoming, type IncomingRead } from "./incoming";
import { labelMarketWithdrawals, readMarketWithdrawals } from "./markets";
import { recordIncoming } from "./observations";
import { readBankDeposits, refreshBankPayouts } from "@/lib/money/bank-activity";
import type { BankDeposit } from "@/lib/providers/bridge/transfers";
import { readWalletDeposits, walletDepositEntry, type WalletDeposit } from "@/lib/deposits/tracking";
import { networkName } from "@/lib/assets/registry";

const RECHECK_MS = 30_000;
const MAX_CHECKS = 3;

type SourceState = { status: "available" | "unavailable"; partial: boolean };
/** `more`: older activity exists than these entries; ask again with `before` set to the oldest entry's time. */
export type History = { entries: ActivityEntry[]; sources: { aura: SourceState; incoming: SourceState; aave: SourceState; card: SourceState }; observedAt: string;
  more: boolean };

type Deps = { bankDeposits?: (subject: string) => Promise<Map<string, BankDeposit>>; refreshPayouts?: (subject: string) => Promise<unknown>;
  readIncoming?: typeof readIncoming; aave?: (wallet: string) => Promise<AaveBaseActivity>; check?: typeof checkAction;
  unitCents?: (assetId: string, decimals: number) => Promise<number | null>;
  cards?: (subject: string, window: { since?: Date; until?: Date }) => Promise<CardHistory>;
  walletDeposits?: (subject: string) => Promise<WalletDeposit[]>;
  marketWithdrawals?: typeof readMarketWithdrawals };

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
 *
 * With `before`, an older page: the same sources at or before that time, with
 * nothing re-checked (the client drops entries it already has).
 */
export async function readHistory(db: D1Database, subject: string, wallet: string, now = new Date(), deps: Deps = {}, before?: Date): Promise<History> {
  // Pick up a few bank payouts' latest state from Bridge first, in case a webhook is late.
  if (!before) await (deps.refreshPayouts ?? ((who: string) => refreshBankPayouts(db, { subject: who, limit: 3, now })))(subject).catch(() => undefined);
  const [stored, hashes] = await Promise.all([before ? listActionsBefore(db, subject, before, 100) : listActions(db, subject, 100), listActionHashes(db, subject)]);
  const older = (item: { createdAt: string }) => !before || Date.parse(item.createdAt) <= before.getTime();
  const [incoming, aave, bank, cards, deposits, withdrawals] = await Promise.all([
    (deps.readIncoming ?? readIncoming)(wallet, { exclude: hashes, now, ...(before ? { until: before } : {}) }),
    (deps.aave ?? getAaveBaseActivity)(wallet).catch((): AaveBaseActivity => ({ items: [], partial: false, sourceStatus: "unavailable" })),
    (deps.bankDeposits ?? ((who: string) => readBankDeposits(db, who)))(subject),
    cardReader(db, deps, now)(subject, before ? { until: new Date(before.getTime() + 1000) } : {}),
    // Bridged deposits are a convenience while they travel; a failed read never hides the rest.
    (deps.walletDeposits ?? ((who: string) => readWalletDeposits(db, who, now)))(subject).catch((): WalletDeposit[] => []),
    (deps.marketWithdrawals ?? readMarketWithdrawals)(db, subject)
  ]);
  await recordIncoming(db, subject, wallet, incoming.transfers, now);
  // Opening Transactions also advances a few open actions, so they settle even if the customer left the screen they started on.
  const due = before ? [] : stored.filter((action) => (action.status === "submitted" || action.status === "settling") && (action.transactionHash || action.relayReference)
    && (!action.checkedAt || now.getTime() - Date.parse(action.checkedAt) >= RECHECK_MS)).slice(0, MAX_CHECKS);
  // A check that fails leaves that action as stored; it never hides the customer's other activity.
  const checked = new Map<string, StoredAction>(await Promise.all(due.map(async (action) =>
    [action.id, await (deps.check ?? checkAction)(db, action, now).catch(() => action)] as const)));
  const own = stored.map((action) => actionEntry(checked.get(action.id) ?? action));
  const hashSet = new Set(hashes);
  const aaveEntries: ActivityEntry[] = aave.items.filter(older).filter((item) => !hashSet.has(item.transactionHash.toLowerCase())).map((item) => ({
    id: item.id, origin: "aave", type: item.type === "earn_supply" ? "earn_deposit" : item.type, status: "completed", createdAt: item.createdAt,
    chainId: item.chainId, asset: item.asset, amount: item.amount, estimatedUsd: item.estimatedUsd, counterparty: "Aave", transactionHash: item.transactionHash,
    source: "Aave"
  }));
  // A bridged deposit shows until its transfer on Base does; then that transfer is the row, from the customer's wallet.
  const arrived = new Map(deposits.filter((deposit) => deposit.destinationHash).map((deposit) => [deposit.destinationHash!, deposit]));
  const received = labelMarketWithdrawals(await incomingEntries(incoming, deps, bank), withdrawals, wallet).map((entry) => {
    const deposit = entry.transactionHash ? arrived.get(entry.transactionHash.toLowerCase()) : undefined;
    return deposit ? { ...entry, counterparty: `Your wallet on ${networkName(deposit.sourceChainId)}`, source: `${entry.source} · LI.FI` } : entry;
  });
  const seen = new Set(received.map((entry) => entry.transactionHash?.toLowerCase()));
  const travelling = deposits.filter(older).filter((deposit) => !deposit.destinationHash || !seen.has(deposit.destinationHash)).map(walletDepositEntry);
  const all = [...own, ...received, ...travelling, ...aaveEntries, ...cards.items.map(cardEntry).filter(older)]
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
  // A source that was cut short (100 actions, a page of transfers per network, a page of card items) says nothing about
  // the time before its oldest item, so the page stops there: the next page starts from it, and nothing falls in a gap.
  const oldest = (items: Array<{ createdAt?: string; receivedAt?: string }>) => Math.min(...items.map((item) => Date.parse(item.createdAt ?? item.receivedAt!)));
  const perNetwork = [...new Set(incoming.transfers.map((transfer) => transfer.chainId))].map((chainId) => oldest(incoming.transfers.filter((transfer) => transfer.chainId === chainId)));
  const cuts = [stored.length >= 100 ? oldest(stored) : -Infinity, incoming.partial && perNetwork.length ? Math.max(...perNetwork) : -Infinity,
    cards.partial && cards.items.length ? oldest(cards.items) : -Infinity];
  const floor = Math.max(...cuts);
  const kept = all.filter((entry) => Date.parse(entry.createdAt) >= floor);
  const entries = kept.slice(0, HISTORY_LIMIT);
  const more = kept.length > HISTORY_LIMIT || floor > -Infinity;
  return { entries, more, observedAt: now.toISOString(), sources: {
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
  const [incoming, bank, cards, withdrawals] = await Promise.all([(deps.readIncoming ?? readIncoming)(wallet, { exclude: hashes, since: start, until: end }),
    (deps.bankDeposits ?? ((who: string) => readBankDeposits(db, who)))(subject), cardReader(db, deps, end)(subject, { since: start, until: end }),
    (deps.marketWithdrawals ?? readMarketWithdrawals)(db, subject)]);
  const incomingComplete = incoming.status === "available" && !incoming.partial;
  const cardComplete = cards.status === "available" && !cards.partial;
  const inPeriod = (entry: ActivityEntry) => Date.parse(entry.createdAt) >= start.getTime() && Date.parse(entry.createdAt) < end.getTime();
  const entries = [...actions.map(actionEntry), ...labelMarketWithdrawals(await incomingEntries(incoming, deps, bank), withdrawals, wallet),
    ...cards.items.map(cardEntry).filter(inPeriod)]
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
  return { entries, complete: incomingComplete && cardComplete, incomingComplete, cardComplete };
}
