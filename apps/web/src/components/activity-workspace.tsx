"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownToLine, ArrowDownUp, ArrowLeft, ArrowUpFromLine, CreditCard, Download, ExternalLink, FileSpreadsheet, FileText, LoaderCircle, Search, TrendingUp, X } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/explorer";
import type { ActionView } from "@/lib/client/use-action";
import type { History } from "@/lib/activity/history";
import { CATEGORIES, entriesCsv, entryAmount, entryCategory, entryLabel, statusLabel, STATUSES, type ActivityEntry } from "@/lib/activity/entries";
import { networkName } from "@/lib/assets/registry";
import { exampleActivity } from "@/lib/example/data";
import { ActionJourney, type ActionEvent } from "./action-journey";
import { GuestBanner } from "./guest-banner";

/** An Aura action's journey, re-read every few seconds while it's still moving. Reading it also advances the check. */
function ReceiptJourney({ id }: { id: string }) {
  const api = useApi();
  const detail = useQuery({
    queryKey: ["action", id],
    queryFn: () => api<{ action: ActionView; events: ActionEvent[] }>(`/api/actions/${encodeURIComponent(id)}`),
    refetchInterval: (query) => ["submitted", "settling"].includes(query.state.data?.action.status ?? "") ? 10_000 : false
  });
  if (!detail.data) return detail.isError ? null : <div className="txState" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Loading its progress</div>;
  return <ActionJourney action={detail.data.action} events={detail.data.events} />;
}

const short = (value?: string) => value && value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
const incoming = (entry: ActivityEntry) => entry.type === "received" || entry.type === "bank_deposit" || entry.type === "card_refund";
const when = (value: string) => new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });

function EntryIcon({ entry }: { entry: ActivityEntry }) {
  const Icon = incoming(entry) ? ArrowDownToLine : entry.origin === "card" ? CreditCard : entry.type === "swap" || entry.type === "bridge" ? ArrowDownUp
    : entry.type.startsWith("earn") ? TrendingUp : ArrowUpFromLine;
  return <span className="txIcon" aria-hidden="true"><Icon /></span>;
}

const Status = ({ entry }: { entry: ActivityEntry }) => <span className={`txStatus txStatus-${entry.status}`}>{statusLabel(entry.status)}</span>;

function save(name: string, csv: string | Blob) {
  const url = URL.createObjectURL(typeof csv === "string" ? new Blob([csv], { type: "text/csv;charset=utf-8" }) : csv);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

/** Journey J12: a transaction's receipt. A side panel on desktop, with the list still in view; a pushed screen on the phone. */
function Receipt({ entry, onClose, isExample }: { entry: ActivityEntry; onClose: () => void; isExample: boolean }) {
  const links = [{ name: "View on the network", url: explorerTx(entry.chainId, entry.transactionHash) },
    { name: "View delivery", url: explorerTx(entry.destinationChainId, entry.destinationTransactionHash) }].filter((link) => link.url);
  const facts: Array<[string, React.ReactNode, string?]> = [
    ["Status", statusLabel(entry.status)],
    ["Date", when(entry.createdAt)],
    ["Network", `${networkName(entry.chainId)}${entry.destinationChainId ? ` to ${networkName(entry.destinationChainId)}` : ""}`],
    ...(entry.counterparty ? [[incoming(entry) ? "From" : "To", <span className="txBreak" key="who">{entry.counterparty}</span>] as [string, React.ReactNode]] : []),
    ...(entry.bankStatus ? [["Bank", entry.bankStatus, "bank-status"] as [string, React.ReactNode, string]] : []),
    ...(entry.cardDispute ? [["Dispute", entry.cardDispute === "submitted" ? "Under review" : entry.cardDispute === "won" ? "Won" : entry.cardDispute === "lost" ? "Lost" : entry.cardDispute] as [string, React.ReactNode]] : []),
    ...(entry.estimatedUsd !== undefined ? [[entry.origin === "incoming" ? "Value today" : "Value", `$${entry.estimatedUsd.toFixed(2)}`] as [string, React.ReactNode]] : []),
    ["Source", entry.source],
    ...(entry.origin === "aura" ? [["Reference", <span className="txBreak" key="ref">{entry.id}</span>] as [string, React.ReactNode]] : []),
    ...(entry.failureReason ? [["Reason", entry.failureReason] as [string, React.ReactNode]] : [])
  ];
  const amount = entryAmount(entry);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="ovScrim" />
      <Dialog.Content className="ovPanel txReceipt" aria-describedby={undefined}>
        <div className="ovPanelHead">
          <Dialog.Close className="appIconButton ovPanelBack" aria-label="Back"><ArrowLeft aria-hidden="true" /></Dialog.Close>
          <Dialog.Title>{entryLabel(entry.type)}</Dialog.Title>
          <Dialog.Close className="appIconButton ovPanelClose" aria-label="Close"><X aria-hidden="true" /></Dialog.Close>
        </div>
        <div className="txReceiptAmount"><strong className={incoming(entry) && entry.status === "completed" ? "txIn" : undefined}>{amount ? `${incoming(entry) ? "+" : ""}${amount}` : statusLabel(entry.status)}</strong><Status entry={entry} /></div>
        <dl className="ovFacts">{facts.map(([label, value, testId]) => <div key={label}><dt>{label}</dt><dd data-testid={testId}>{value}</dd></div>)}</dl>
        {entry.origin === "aura" && !isExample ? <ReceiptJourney id={entry.id} />
          : entry.origin === "incoming" ? <p className="ovNote" data-testid="incoming-finality">{entry.final
            ? `Final on ${networkName(entry.chainId)}.` : `Received. ${networkName(entry.chainId)} makes it final in about 20 minutes.`}</p>
            : entry.origin === "card" ? <p className="ovNote" data-testid="card-payment-note">{entry.status === "pending"
              ? "The merchant hasn't settled this yet. The amount can change or be released." : entry.status === "failed"
                ? "No money moved." : "Paid with your card from your USDC on Base. Manage or dispute it on Cards."}</p> : null}
        {!isExample && <div className="ovPanelActions">
          {entry.origin === "card" && <Link className="appButton appButtonLarge" href="/app/cards">Open Cards</Link>}
          {entry.origin === "aura" && <Link className="appButton appButtonLarge" href={`/app/transactions/${entry.id}`}>Full history</Link>}
          {links.map((link) => <a className="appButton appButtonLarge" key={link.name} href={link.url!} target="_blank" rel="noreferrer">{link.name} <ExternalLink aria-hidden="true" /></a>)}
          {!links.length && entry.origin !== "card" && <p className="ovNote">No transaction has been recorded for this yet.</p>}
        </div>}
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Journey J13: this list, the tax-support preview, or a month's statement. A dialog on desktop, a sheet on the phone. */
function ExportDialog({ entries, onClose }: { entries: ActivityEntry[]; onClose: () => void }) {
  const { getAccessToken } = usePrivy();
  const [month, setMonth] = useState(new Date().toISOString().slice(0, 7));
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
  const tax = { header: ["Tax classification", "Cost basis"], row: () => ["Review required", "Unavailable"] };
  const date = new Date().toISOString().slice(0, 10);
  return <Dialog.Root open onOpenChange={(open) => { if (!open) onClose(); }}>
    <Dialog.Portal>
      <Dialog.Overlay className="mxDialogOverlay" />
      <Dialog.Content className="mxDialog" aria-describedby="export-note">
        <div className="mxDialogHead"><Dialog.Title>Export</Dialog.Title>
          <Dialog.Close className="appIconButton" aria-label="Close"><X aria-hidden="true" /></Dialog.Close></div>
        <p id="export-note" className="mxDialogNote">Download the {entries.length} transactions in your list, or a full month.</p>
        <div className="txExport">
          <button type="button" className="txExportRow" onClick={() => save(`aura-transactions-${date}.csv`, entriesCsv(entries, networkName))}>
            <span className="txIcon" aria-hidden="true"><Download /></span><span className="txExportText"><strong>This list</strong><small>The transactions shown, with your filters</small></span></button>
          <button type="button" className="txExportRow" onClick={() => save(`aura-tax-support-${date}.csv`, entriesCsv(entries, networkName, tax))}>
            <span className="txIcon" aria-hidden="true"><FileSpreadsheet /></span><span className="txExportText"><strong>Tax-support preview</strong><small>The same list; cost basis isn&apos;t available</small></span></button>
          <div className="txExportRow txExportMonth">
            <span className="txIcon" aria-hidden="true"><FileText /></span>
            <label className="txExportText"><strong>Monthly statement</strong>
              <input type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(event) => setMonth(event.target.value)} /></label>
            <button type="button" className="appButton" onClick={() => void downloadStatement()} disabled={statement.state === "loading" || !month}>
              {statement.state === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />} Download</button>
          </div>
        </div>
        {statement.state === "error" && <p className="txNoteError" role="alert">{statement.message}</p>}
        <p className="mxDialogNote">These files support record keeping. They aren&apos;t bank statements, tax returns, or tax advice.</p>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Journey J12: every transaction, searchable, with type chips and a status filter. Guests see labelled examples. */
export function ActivityWorkspace() {
  const { user, ready, authenticated, login } = usePrivy();
  const api = useApi();
  const isExample = ready && !authenticated;
  const loading = !ready;
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [chosen, setChosen] = useState<ActivityEntry | null>(null);
  // A link from Send, Swap, or the Overview opens the transaction straight away: /app/transactions?open=<id>.
  const [openId, setOpenId] = useState(useSearchParams().get("open"));
  const [exportOpen, setExportOpen] = useState(false);
  const query = useQuery({ queryKey: ["activity", user?.id], queryFn: () => api<History>("/api/activity"), enabled: authenticated && Boolean(user), refetchInterval: 30_000 });
  const entries = useMemo(() => isExample ? exampleActivity : query.data?.entries ?? [], [isExample, query.data]);
  const selected = chosen ? entries.find((entry) => entry.id === chosen.id) ?? chosen : entries.find((entry) => entry.id === openId) ?? null;
  const close = () => { setChosen(null); setOpenId(null); };
  const filtered = useMemo(() => entries.filter((entry) => {
    const needle = search.trim().toLowerCase();
    return (category === "All" || entryCategory(entry.type) === category) && (status === "All" || statusLabel(entry.status) === status)
      && (!needle || [entryLabel(entry.type), entry.asset, entry.toAsset, entry.amount, entry.counterparty, entry.transactionHash].some((value) => value?.toLowerCase().includes(needle)));
  }), [entries, category, status, search]);
  const sources = isExample ? undefined : query.data?.sources;
  const listLoading = loading || (!isExample && query.isPending);

  return <div className="mxPage txPage">
    {(isExample || loading) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="txHead"><h1>Transactions</h1>
      <button type="button" className="appButton" onClick={() => isExample ? login() : setExportOpen(true)} disabled={loading || (!isExample && !query.data)}><Download aria-hidden="true" /> Export</button></header>
    {sources?.incoming.status === "unavailable" && <p className="mxNote mxNoteWarning" role="status">Money you received can&apos;t be read right now, so some deposits may be missing from this list.</p>}
    {sources?.incoming.partial && <p className="mxNote mxNoteWarning" role="status">Only your most recent deposits are listed. Use a monthly statement for a full month.</p>}
    {sources?.aave.status === "unavailable" && <p className="mxNote mxNoteWarning" role="status">Aave history can&apos;t be read right now.</p>}
    {sources?.card.status === "unavailable" && <p className="mxNote mxNoteWarning" role="status">Card payments can&apos;t be read from Stripe right now, so some may be missing from this list.</p>}
    <div className="txFilters">
      <label className="txSearch"><Search aria-hidden="true" /><span className="srOnly">Search activity</span>
        <input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label>
      <div className="ovChips txChips" role="group" aria-label="Category">{CATEGORIES.map((item) =>
        <button key={item} type="button" className="ovChip" aria-pressed={category === item} onClick={() => setCategory(item)}>{item}</button>)}</div>
      <label className="mxField txStatusFilter"><span className="srOnly">Status</span>
        <select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{STATUSES.map((item) => <option key={item} value={item}>{item === "All" ? "Any status" : item}</option>)}</select></label>
    </div>
    <section className="mxCard txList" aria-label="Transaction list">
      {listLoading ? <div className="txState" role="status"><LoaderCircle className="spin" aria-hidden="true" /> Checking activity</div>
        : !isExample && query.isError ? <p className="mxNote mxNoteError" role="alert">Activity couldn&apos;t be loaded. <button type="button" className="appTextButton mxInlineButton" onClick={() => void query.refetch()}>Try again</button></p>
          : filtered.length === 0 ? <div className="txEmpty"><strong>{entries.length ? "No matching activity" : "No activity yet"}</strong>
            <span>{entries.length ? "Try changing the filters." : "Money you send, receive, swap, or earn will appear here."}</span></div>
            : <ul className="txRows">{filtered.map((entry) => { const amount = entryAmount(entry); return <li key={entry.id}>
              <button type="button" className="activityRow txRow" data-testid={`entry-${entry.id}`} onClick={() => setChosen(entry)}>
                <EntryIcon entry={entry} />
                <span className="txWhat"><strong>{entryLabel(entry.type)}</strong>
                  <small>{when(entry.createdAt)} · {networkName(entry.chainId)}{entry.counterparty ? ` · ${short(entry.counterparty)}` : ""}</small></span>
                <span className="txAmount"><strong className={incoming(entry) && entry.status === "completed" ? "txIn" : undefined}>{amount ? `${incoming(entry) ? "+" : ""}${amount}` : "—"}</strong><Status entry={entry} /></span>
              </button></li>; })}</ul>}
    </section>
    <p className="mxHint">Your Aura transactions are checked against the network. Money you received comes from Alchemy&apos;s record of the network, and Aave history from Aave.</p>
    {exportOpen && <ExportDialog entries={filtered} onClose={() => setExportOpen(false)} />}
    {selected && <Receipt entry={selected} onClose={close} isExample={isExample} />}
  </div>;
}
