"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowUpFromLine, CandlestickChart, CirclePercent, CreditCard, Download, ExternalLink, FileText, LoaderCircle, MessageCircle, Search, SlidersHorizontal, TrendingUp, X } from "lucide-react";
import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/explorer";
import type { ActionView } from "@/lib/client/use-action";
import type { History } from "@/lib/activity/history";
import { CATEGORIES, entriesCsv, entryCategory, entryDirection, entryLabel, statusLabel, STATUSES, type ActivityEntry } from "@/lib/activity/entries";
import { ASSETS, BASE_CHAIN_ID, networkName } from "@/lib/assets/registry";
import { failureText } from "@/lib/client/action-copy";
import { exampleHistory, exampleNow } from "@/lib/example/data";
import { formatDateTime, formatTime, formatToken, formatUsd, shortAddress } from "@/lib/format";
import { buildInsights } from "@/lib/insights/presentation";
import { ActionJourney, type ActionEvent } from "./action-journey";
import { CopyButton } from "./copy-button";
import { GuestBanner } from "./guest-banner";
import { LoadingState, Notice } from "./states";
import { entryTone, StatusDot } from "./status-dot";
import { Sheet } from "./sheet";
import { useSupportChat } from "./support-chat";
import { periodName, totalName, TransactionsSummary, type Period, type Summary, type SummaryTotal } from "./transactions-summary";

/** An Aura action's journey, re-read every few seconds while it's still moving. Reading it also advances the check. */
function ReceiptJourney({ id }: { id: string }) {
  const api = useApi();
  const detail = useQuery({
    queryKey: ["action", id],
    queryFn: () => api<{ action: ActionView; events: ActionEvent[] }>(`/api/actions/${encodeURIComponent(id)}`),
    refetchInterval: (query) => ["submitted", "settling"].includes(query.state.data?.action.status ?? "") ? 10_000 : false
  });
  if (!detail.data) return detail.isError ? null : <LoadingState label="Loading its progress" />;
  const bankUpdates = detail.data.events.filter((event) => event.type === "bank_payout");
  return <>
    <ActionJourney action={detail.data.action} events={detail.data.events} />
    {bankUpdates.length > 0 && <section className="txBankUpdates" aria-labelledby="bank-updates"><h3 id="bank-updates">Bank updates</h3>
      <ol className="actionJourney">{bankUpdates.map((event, index) => <li key={`${event.type}-${index}`} className="done"><i />
        <span><strong>{bankStateText[String(event.evidence.state)] ?? "Bank update"}</strong><small>{formatDateTime(event.occurredAt)}</small></span></li>)}</ol>
    </section>}
  </>;
}

const bankStateText: Record<string, string> = { awaiting_funds: "Waiting for your USDC", funds_received: "Bridge received your USDC",
  payment_submitted: "Sent to your bank", payment_processed: "Delivered to your bank", returned: "Returned by the bank", refunded: "Refunded" };

const incoming = (entry: ActivityEntry) => entry.type === "received" || entry.type === "bank_deposit" || entry.type === "card_refund";
/** Setting the card's allowance, or turning card spending off, moves no money. */
const setting = (entry: ActivityEntry) => entry.type === "card_allowance" || entry.type === "card_spending_off";

/** An amount as people read it: card amounts in dollars, tokens with at most 4 decimals ("20 USDC", "$8.50"). */
function money(amount: string, asset?: string) {
  return asset === "USD" ? formatUsd(amount) : formatToken(amount, asset);
}

/** The row's amount: what was paid, signed when money came in. A swap's other side is in the row's detail line. */
function rowAmount(entry: ActivityEntry) {
  if (!entry.amount || setting(entry)) return undefined;
  return `${incoming(entry) ? "+" : ""}${money(entry.amount, entry.asset)}`;
}

/** The receipt's headline: the whole amount, both sides of a swap. */
function receiptAmount(entry: ActivityEntry) {
  if (!entry.amount) return statusLabel(entry.status);
  if (entry.type === "card_spending_off") return "Off";
  if (entry.type === "card_allowance") return `Up to ${money(entry.amount, entry.asset)}`;
  const paid = money(entry.amount, entry.asset);
  if (entry.toAmount && entry.toAsset && (entry.type === "swap" || entry.type === "bridge")) return `${paid} for ${money(entry.toAmount, entry.toAsset)}`;
  return `${incoming(entry) ? "+" : ""}${paid}`;
}

/** Networks, only when the money isn't simply on Base: "Ethereum", "Base to Arbitrum". */
function networks(entry: ActivityEntry) {
  const to = entry.destinationChainId && entry.destinationChainId !== entry.chainId ? entry.destinationChainId : undefined;
  if (entry.chainId === BASE_CHAIN_ID && !to) return undefined;
  return to ? `${networkName(entry.chainId)} to ${networkName(to)}` : networkName(entry.chainId);
}

/** The row's detail line: time, who, and anything else that tells rows apart. */
function rowDetail(entry: ActivityEntry) {
  const where = networks(entry);
  const who = entry.counterparty ? (entry.counterparty.startsWith("0x") ? shortAddress(entry.counterparty) : entry.counterparty) : undefined;
  const swapped = (entry.type === "swap" || entry.type === "bridge") && entry.asset && entry.toAsset && entry.toAsset !== entry.asset ? `${entry.asset} to ${entry.toAsset}` : undefined;
  return [formatTime(entry.createdAt), swapped, who, where && !who?.includes(where) ? where : undefined].filter(Boolean).join(" · ");
}

const dayFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });
const dayYearFormat = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric" });
const dayKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;

/** A day heading: "Today", "Yesterday", "Sep 29", or "Dec 20, 2025" in another year. */
function dayLabel(iso: string, now: Date) {
  const date = new Date(iso);
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  if (dayKey(date) === dayKey(now)) return "Today";
  if (dayKey(date) === dayKey(yesterday)) return "Yesterday";
  return (date.getFullYear() === now.getFullYear() ? dayFormat : dayYearFormat).format(date);
}

/** Entries, newest first, grouped under their day. */
function byDay(entries: ActivityEntry[], now: Date) {
  const days: Array<{ label: string; entries: ActivityEntry[] }> = [];
  for (const entry of entries) {
    const label = dayLabel(entry.createdAt, now);
    if (days.at(-1)?.label === label) days.at(-1)!.entries.push(entry);
    else days.push({ label, entries: [entry] });
  }
  return days;
}

/** "a", "a and b", "a, b and c". */
const listOf = (items: string[]) => items.length < 2 ? items.join("") : `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;

/** The last 24 months, newest first, for the statement picker. */
function recentMonths(now: Date) {
  return Array.from({ length: 24 }, (_, index) => {
    const month = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1));
    return { value: month.toISOString().slice(0, 7), label: month.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" }) };
  });
}

function EntryIcon({ entry }: { entry: ActivityEntry }) {
  const Icon = setting(entry) ? SlidersHorizontal : entry.type.startsWith("perps_") ? CandlestickChart : entry.type.startsWith("predictions_") ? CirclePercent
    : incoming(entry) ? ArrowDownToLine : entry.origin === "card" ? CreditCard : entry.type === "swap" || entry.type === "bridge" ? ArrowDownUp
    : entry.type.startsWith("earn") ? TrendingUp : ArrowUpFromLine;
  return <span className="appIconDisc" aria-hidden="true"><Icon /></span>;
}

const Status = ({ entry }: { entry: ActivityEntry }) => <StatusDot tone={entryTone(entry.status)} label={statusLabel(entry.status)} />;

function save(name: string, csv: string | Blob) {
  const url = URL.createObjectURL(typeof csv === "string" ? new Blob([csv], { type: "text/csv;charset=utf-8" }) : csv);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

/** A dollar coin (USDC, or a card amount in dollars): its value in dollars is the amount itself. */
const dollars = (asset?: string) => asset === "USD" || ASSETS.some((item) => item.symbol === asset && item.price.kind === "usd");

/** Money that came to the account from somewhere: received, refunded, borrowed, or withdrawn from Earn, Perps, or Predictions. */
const fromSomewhere = (entry: ActivityEntry) => incoming(entry) || ["earn_withdraw", "perps_withdraw", "predictions_withdraw", "borrow"].includes(entry.type);

/**
 * What happened, in one line, worded the same for every kind of transaction:
 * nothing moved, still on its way, or done (and then only what's worth knowing).
 * "No money moved" only where that's certain: a failed Aura action can have
 * moved money (refunded, partly delivered), and then its Reason says what happened.
 */
function receiptNote(entry: ActivityEntry) {
  if (entry.status === "not_confirmed") return "No money moved.";
  if (entry.status === "failed") {
    if (entry.origin === "card") return "No money moved.";
    if (entry.origin === "deposit") return "Nothing arrived in your Aura account.";
    return entry.origin === "aura" && !entry.transactionHash && !entry.failureReason ? "No money moved." : undefined;
  }
  if (entry.origin === "card") return entry.status === "pending"
    ? "The merchant hasn't finished this payment yet, so the amount can still change or be released."
    : entry.type === "card_refund" ? "The merchant refunded this to your USDC." : "Paid with your card from your USDC.";
  if (entry.origin === "deposit") return entry.status === "pending" ? "On its way from your wallet. It usually arrives in a few minutes." : undefined;
  if (entry.origin === "incoming") return entry.final ? undefined : "Received. It's fully confirmed in about 20 minutes.";
  return undefined;
}

const noteTestId: Partial<Record<ActivityEntry["origin"], string>> = { card: "card-payment-note", deposit: "deposit-note", incoming: "incoming-finality" };

/** Journey J12: a transaction's receipt, with its progress. A side panel on desktop, with the list still in view; a pushed screen on the phone. */
function Receipt({ entry, onClose, isExample }: { entry: ActivityEntry; onClose: () => void; isExample: boolean }) {
  const links = [{ name: "View on the network", url: explorerTx(entry.chainId, entry.transactionHash) },
    { name: "View delivery", url: explorerTx(entry.destinationChainId, entry.destinationTransactionHash) }].filter((link) => link.url);
  const where = networks(entry);
  const who = entry.counterparty ? <span className={entry.counterparty.startsWith("0x") ? "mxBreak" : undefined} key="who">{entry.counterparty}</span> : undefined;
  // Aura records why an action failed as a code; card and deposit providers' reasons are already words.
  const reason = entry.status === "failed" ? (entry.origin === "aura" ? failureText(entry.failureReason ?? null) : entry.failureReason) : undefined;
  const facts: Array<[string, React.ReactNode, string?]> = [
    ["Date", formatDateTime(entry.createdAt)],
    ...(who ? [[fromSomewhere(entry) ? "From" : setting(entry) ? "For" : "To", who] as [string, React.ReactNode]] : []),
    ...(where ? [["Network", where] as [string, React.ReactNode]] : []),
    ...(entry.bankStatus ? [["Bank", entry.bankStatus, "bank-status"] as [string, React.ReactNode, string]] : []),
    ...(entry.cardDispute ? [["Dispute", entry.cardDispute === "submitted" ? "Under review" : entry.cardDispute === "won" ? "Won" : entry.cardDispute === "lost" ? "Lost" : entry.cardDispute] as [string, React.ReactNode]] : []),
    // A dollar coin's value is its amount; anything else (ETH, gold, stocks) shows what it was worth.
    ...(entry.estimatedUsd !== undefined && !dollars(entry.asset) ? [[entry.origin === "incoming" ? "Value today" : "Value", formatUsd(entry.estimatedUsd)] as [string, React.ReactNode]] : []),
    ...(reason ? [["Reason", reason] as [string, React.ReactNode]] : [])
  ];
  const note = receiptNote(entry);
  const chat = useSupportChat();
  const help = !isExample && chat.status !== "unavailable";
  function getHelp() {
    // The receipt closes first: it holds focus while open, so the chat window couldn't be used on top of it.
    onClose();
    chat.open(`I need help with this transaction: ${entryLabel(entry.type)}, ${receiptAmount(entry)}, ${formatDateTime(entry.createdAt)}. Reference: ${entry.id}`);
  }
  return <Sheet variant="panel" className="txReceipt" onOpenChange={(open) => { if (!open) onClose(); }}>
        <div className="ovPanelHead">
          <Dialog.Close className="appIconButton ovPanelBack" aria-label="Back"><ArrowLeft aria-hidden="true" /></Dialog.Close>
          <Dialog.Title>{entryLabel(entry.type)}</Dialog.Title>
          <Dialog.Close className="appIconButton ovPanelClose" aria-label="Close"><X aria-hidden="true" /></Dialog.Close>
        </div>
        <div className="txReceiptAmount"><strong className={incoming(entry) && entry.status === "completed" ? "txIn" : undefined}>{receiptAmount(entry)}</strong><Status entry={entry} /></div>
        <dl className="ovFacts">{facts.map(([label, value, testId]) => <div key={label}><dt>{label}</dt><dd data-testid={testId}>{value}</dd></div>)}</dl>
        {note && <p className="ovNote" data-testid={noteTestId[entry.origin] ?? "receipt-note"}>{note}</p>}
        {entry.origin === "aura" && !isExample && <ReceiptJourney id={entry.id} />}
        {!isExample && (entry.origin === "card" || links.length > 0 || help) && <div className="ovPanelActions">
          {entry.origin === "card" && <Link className="appButton appButtonLarge" href="/app/cards">Open Cards</Link>}
          {links.map((link) => <a className="appButton appButtonLarge" key={link.name} href={link.url!} target="_blank" rel="noreferrer">{link.name} <ExternalLink aria-hidden="true" /></a>)}
          {/* Chat opens with this transaction already described, so there's nothing to copy across. Hidden when chat can't load. */}
          {help && <button type="button" className="appButton appButtonLarge" disabled={chat.status !== "ready"} onClick={getHelp}>
            {chat.status === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <MessageCircle aria-hidden="true" />} Get help with this</button>}
        </div>}
        {/* The same last line on every receipt: one thing to give Support, whatever kind of transaction it is. */}
        <div className="txReceiptRef"><span>Reference <span className="mxBreak" data-testid="receipt-reference">{entry.id}</span></span>
          {!isExample && <CopyButton value={entry.id} ariaLabel="Copy reference" className="appTextButton" />}</div>
  </Sheet>;
}

/** Journey J13: this list, or a month's statement. A dialog on desktop, a sheet on the phone. */
function ExportDialog({ entries, onClose }: { entries: ActivityEntry[]; onClose: () => void }) {
  const { getAccessToken } = useAuth();
  const months = useMemo(() => recentMonths(new Date()), []);
  const [month, setMonth] = useState(months[0].value);
  const [statement, setStatement] = useState<{ state: "idle" | "loading" | "error"; message?: string }>({ state: "idle" });
  async function downloadStatement() {
    setStatement({ state: "loading" });
    try {
      const token = await getAccessToken();
      const response = await fetch(`/api/statements?month=${month}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        return setStatement({ state: "error", message: body.message ?? "The statement couldn't be made. Try again." });
      }
      save(`aura-statement-${month}.csv`, await response.blob());
      setStatement({ state: "idle" });
    } catch { setStatement({ state: "error", message: "The statement couldn't be made. Try again." }); }
  }
  const date = new Date().toISOString().slice(0, 10);
  return <Sheet onOpenChange={(open) => { if (!open) onClose(); }} describedBy="export-note">
        <div className="mxDialogHead"><Dialog.Title>Export</Dialog.Title>
          <Dialog.Close className="appIconButton" aria-label="Close"><X aria-hidden="true" /></Dialog.Close></div>
        <p id="export-note" className="mxDialogNote">Download the {entries.length} transactions in your list, or a full month.</p>
        <div className="txExport">
          <button type="button" className="txExportRow" onClick={() => save(`aura-transactions-${date}.csv`, entriesCsv(entries, networkName))}>
            <span className="appIconDisc" aria-hidden="true"><Download /></span><span className="txExportText"><strong>This list</strong><small>The transactions shown, with your filters</small></span></button>
          <div className="txExportRow txExportMonth">
            <span className="appIconDisc" aria-hidden="true"><FileText /></span>
            <label className="txExportText"><strong>Monthly statement</strong>
              <select value={month} onChange={(event) => setMonth(event.target.value)}>{months.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>
            <button type="button" className="appButton" onClick={() => void downloadStatement()} disabled={statement.state === "loading" || !month}>
              {statement.state === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />} Download</button>
          </div>
        </div>
        {statement.state === "error" && <p className="txNoteError" role="alert">{statement.message}</p>}
        <p className="mxDialogNote">These files support record keeping. They aren&apos;t bank statements, tax returns, or tax advice.</p>
  </Sheet>;
}

/** Journey J12: a summary of the period on top, then every transaction, searchable, with type chips and a status filter. Guests see labelled examples. */
export function ActivityWorkspace() {
  const { user, ready, authenticated, login } = useAuth();
  const api = useApi();
  const isExample = ready && !authenticated;
  const loading = !ready;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [days, setDays] = useState<Period>(30);
  // A total tapped in the summary: the list shows the completed transactions that add up to it.
  const [total, setTotal] = useState<SummaryTotal | null>(null);
  const listRef = useRef<HTMLElement>(null);
  const [chosen, setChosen] = useState<ActivityEntry | null>(null);
  // A link from Send, Swap, or the Overview opens the transaction straight away: /app/transactions?open=<id>.
  const [openId, setOpenId] = useState(useSearchParams().get("open"));
  const [exportOpen, setExportOpen] = useState(false);
  const query = useQuery({ queryKey: ["activity", user?.id], queryFn: () => api<History>("/api/activity"), enabled: authenticated && Boolean(user), refetchInterval: 30_000 });
  // Older pages the customer asked for with "Show more", oldest last. A new account or sign-in starts over.
  const [olderPages, setOlderPages] = useState<{ owner?: string; pages: History[] }>({ pages: [] });
  const [olderState, setOlderState] = useState<"idle" | "loading" | "error">("idle");
  const pages = useMemo(() => olderPages.owner === user?.id ? olderPages.pages : [], [olderPages, user?.id]);
  const entries = useMemo(() => {
    if (isExample) return exampleHistory;
    const seen = new Set<string>();
    return [...query.data?.entries ?? [], ...pages.flatMap((page) => page.entries)].filter((entry) => !seen.has(entry.id) && Boolean(seen.add(entry.id)));
  }, [isExample, query.data, pages]);
  const more = !isExample && Boolean(pages.length ? pages.at(-1)!.more : query.data?.more);
  async function showMore() {
    const oldest = entries.at(-1);
    if (!oldest) return;
    setOlderState("loading");
    try {
      const page = await api<History>(`/api/activity?before=${encodeURIComponent(oldest.createdAt)}`);
      // A page that adds nothing new ends the list rather than offering the same page again.
      const known = new Set(entries.map((entry) => entry.id));
      const fresh = page.entries.some((entry) => !known.has(entry.id));
      setOlderPages({ owner: user?.id, pages: [...pages, fresh ? page : { ...page, more: false }] });
      setOlderState("idle");
    } catch { setOlderState("error"); }
  }

  // The summary is read again when a new transaction completes, and otherwise kept for a few minutes: totals change slowly.
  const latestCompleted = query.data?.entries.find((entry) => entry.status === "completed")?.id ?? "none";
  const summaryQuery = useQuery<Summary>({
    queryKey: ["insights", user?.id, days, latestCompleted],
    queryFn: () => api<Summary>(`/api/insights?days=${days}`),
    enabled: authenticated && Boolean(user) && query.isSuccess,
    staleTime: 5 * 60_000,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[2] === days ? previous : undefined
  });
  const exampleSummary = useMemo<Summary | null>(() => isExample
    ? { ...buildInsights(exampleHistory, exampleNow, days), incomingComplete: true, outgoingComplete: true } : null, [isExample, days]);
  const summary = exampleSummary ?? summaryQuery.data;
  // Guests' example year is counted as of its own date, so their totals and list agree.
  const asOf = isExample ? exampleNow.getTime() : query.dataUpdatedAt;
  const since = useMemo(() => new Date(asOf - days * 86_400_000).toISOString(), [asOf, days]);

  const selected = chosen ? entries.find((entry) => entry.id === chosen.id) ?? chosen : entries.find((entry) => entry.id === openId) ?? null;
  const close = () => { setChosen(null); setOpenId(null); };
  const filtered = useMemo(() => entries.filter((entry) => {
    const needle = search.trim().toLowerCase();
    if (total && (entry.status !== "completed" || entryDirection(entry.type) !== total || entry.createdAt < since)) return false;
    return (category === "All" || entryCategory(entry.type) === category) && (status === "All" || statusLabel(entry.status) === status)
      && (!needle || [entryLabel(entry.type), entry.asset, entry.toAsset, entry.amount, entry.counterparty, entry.transactionHash].some((value) => value?.toLowerCase().includes(needle)));
  }), [entries, category, status, search, total, since]);
  const sources = isExample ? undefined : query.data?.sources;
  const listLoading = loading || (!isExample && query.isPending);
  const missing = [sources?.incoming.status === "unavailable" && "money you received", sources?.card.status === "unavailable" && "card payments",
    sources?.aave.status === "unavailable" && "Aave history"].filter((item): item is string => Boolean(item));
  const dayGroups = useMemo(() => byDay(filtered, new Date()), [filtered]);
  // A new account has nothing to sum up: one empty state with a way to add money, not a row of $0.
  const noActivity = !isExample && query.isSuccess && entries.length === 0 && missing.length === 0;

  /** Narrow the list to a total's transactions (a second tap on the same total clears it), then show the list. */
  function showTotal(next: SummaryTotal) {
    setTotal(total === next ? null : next);
    setCategory("All"); setStatus("All"); setSearch("");
    requestAnimationFrame(() => listRef.current?.focus({ preventScroll: true }));
    listRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }
  function showMerchant(name: string) {
    setTotal(null); setStatus("All"); setCategory("Card"); setSearch(name);
    listRef.current?.scrollIntoView({ behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth", block: "start" });
  }

  return <div className="mxPage txPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="txHead"><h1>Transactions</h1>
      <button type="button" className="appButton" onClick={() => isExample ? login() : setExportOpen(true)} disabled={loading || (!isExample && !query.data)}><Download aria-hidden="true" /> Export</button></header>
    {!noActivity && !(!isExample && query.isError) && <TransactionsSummary data={summary ?? undefined} days={days} onDays={setDays}
      loading={loading || (!isExample && (query.isPending || (summaryQuery.isPending && !summaryQuery.isError)))}
      error={!isExample && summaryQuery.isError} onRetry={() => void summaryQuery.refetch()} total={total} onTotal={showTotal} onMerchant={showMerchant} />}
    {missing.length > 0 && <Notice tone="warning" role="status">{missing[0][0].toUpperCase() + listOf(missing).slice(1)} can&apos;t be read right now, so some activity may be missing.</Notice>}
    {!noActivity && <div className="txFilters">
      <label className="txSearch"><Search aria-hidden="true" /><span className="srOnly">Search activity</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label>
      <div className="ovChips txChips" role="group" aria-label="Category">{CATEGORIES.map((item) =>
        <button key={item} type="button" className="ovChip" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <label className="mxField txStatusFilter"><span className="srOnly">Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{STATUSES.map((item) => <option key={item} value={item}>{item === "All" ? "Any status" : item}</option>)}</select></label>
    </div>}
    {total && <div className="txFocus" role="status">
      <span>Showing <strong>{totalName[total].toLowerCase()}</strong> in the last {periodName(days)}</span>
      <button type="button" className="appButton" onClick={() => setTotal(null)}><X aria-hidden="true" /> Show all</button></div>}
    <section className="mxCard txList" aria-label="Transaction list" ref={listRef} tabIndex={-1}>
      {listLoading ? <LoadingState label="Checking activity" />
        : !isExample && query.isError ? <Notice tone="error" role="alert" onRetry={() => void query.refetch()}>Activity couldn&apos;t be loaded. If this keeps happening, contact Support.</Notice>
          : noActivity ? <div className="txEmpty"><strong>No transactions yet</strong>
            <span>Money you add, send, swap, or earn will appear here.</span>
            <Link className="appButton appButtonPrimary" href="/app/deposit">Add money</Link></div>
          : filtered.length === 0 ? <div className="txEmpty"><strong>No matching activity</strong>
            <span>{total ? `No ${totalName[total].toLowerCase()} in the last ${periodName(days)}${more ? " among the transactions loaded so far" : ""}.` : "Try changing the filters."}</span></div>
            : dayGroups.map((day) => <section className="txDay" key={day.label} aria-label={day.label}><h2>{day.label}</h2>
              <ul className="txRows">{day.entries.map((entry) => { const amount = rowAmount(entry); return <li key={entry.id}>
                <button type="button" className="activityRow txRow" data-testid={`entry-${entry.id}`} onClick={() => setChosen(entry)}>
                  <EntryIcon entry={entry} />
                  <span className="txWhat"><strong>{entryLabel(entry.type)}</strong><small>{rowDetail(entry)}</small></span>
                  <span className="txAmount">{amount && <strong className={incoming(entry) && entry.status === "completed" ? "txIn" : undefined}>{amount}</strong>}<Status entry={entry} /></span>
                </button></li>; })}</ul></section>)}
    </section>
    {more && !listLoading && !query.isError && <div className="txMore">
      {olderState === "error" && <Notice tone="error" role="alert">Older activity couldn&apos;t be loaded. Try again.</Notice>}
      <button type="button" className="appButton" onClick={() => void showMore()} disabled={olderState === "loading"}>
        {olderState === "loading" && <LoaderCircle className="spin" aria-hidden="true" />} Show more</button>
    </div>}
    {exportOpen && <ExportDialog entries={filtered} onClose={() => setExportOpen(false)} />}
    {selected && <Receipt entry={selected} onClose={close} isExample={isExample} />}
  </div>;
}
