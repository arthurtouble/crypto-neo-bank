"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, Check, Clock3, Download, ExternalLink, FileSpreadsheet, LoaderCircle, Search, ShieldCheck, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useApi } from "@/lib/client/api";
import { explorerTx } from "@/lib/client/explorer";
import type { ActionView } from "@/lib/client/use-action";
import type { History } from "@/lib/activity/history";
import { CATEGORIES, entriesCsv, entryAmount, entryCategory, entryLabel, statusLabel, STATUSES, type ActivityEntry } from "@/lib/activity/entries";
import { networkName } from "@/lib/assets/registry";
import { ActionJourney, type ActionEvent } from "./action-journey";

/** An Aura action's journey, re-read every few seconds while it's still moving. Reading it also advances the check. */
function ReceiptJourney({ id }: { id: string }) {
  const api = useApi();
  const detail = useQuery({
    queryKey: ["action", id],
    queryFn: () => api<{ action: ActionView; events: ActionEvent[] }>(`/api/actions/${encodeURIComponent(id)}`),
    refetchInterval: (query) => ["submitted", "settling"].includes(query.state.data?.action.status ?? "") ? 10_000 : false
  });
  if (!detail.data) return detail.isError ? null : <div className="actionJourney"><LoaderCircle className="spin" size={16} /></div>;
  return <ActionJourney action={detail.data.action} events={detail.data.events} />;
}

const short = (value?: string) => value && value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value;
const StatusIcon = ({ entry }: { entry: ActivityEntry }) => entry.status === "completed" ? <Check size={14} />
  : entry.status === "failed" || entry.status === "not_confirmed" ? <XCircle size={14} /> : <Clock3 size={14} />;
const tone = (entry: ActivityEntry) => entry.status === "completed" ? "good" : entry.status === "pending" ? "neutral" : "bad";

function save(name: string, csv: string | Blob) {
  const url = URL.createObjectURL(typeof csv === "string" ? new Blob([csv], { type: "text/csv;charset=utf-8" }) : csv);
  const anchor = document.createElement("a"); anchor.href = url; anchor.download = name; anchor.click(); URL.revokeObjectURL(url);
}

function Receipt({ entry, onClose }: { entry: ActivityEntry; onClose: () => void }) {
  const links = [{ name: "View on the network", url: explorerTx(entry.chainId, entry.transactionHash) },
    { name: "View delivery", url: explorerTx(entry.destinationChainId, entry.destinationTransactionHash) }].filter((link) => link.url);
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="financialModal receiptModal" role="dialog" aria-modal="true" aria-labelledby="receipt-title">
      <button className="modalClose" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <div className={`receiptStatus ${tone(entry)}`}><StatusIcon entry={entry} /></div>
      <h2 id="receipt-title">{entryLabel(entry.type)}</h2>
      <strong className="receiptAmount">{entryAmount(entry) ?? statusLabel(entry.status)}</strong>
      <div className="receiptDetails">
        <span>Status<strong>{statusLabel(entry.status)}</strong></span>
        <span>Date<strong>{new Date(entry.createdAt).toLocaleString()}</strong></span>
        <span>Network<strong>{networkName(entry.chainId)}{entry.destinationChainId ? ` to ${networkName(entry.destinationChainId)}` : ""}</strong></span>
        {entry.counterparty && <span>{entry.type === "received" ? "From" : "To"}<strong>{entry.counterparty}</strong></span>}
        {entry.estimatedUsd !== undefined && <span>{entry.origin === "incoming" ? "Value today" : "Value"}<strong>${entry.estimatedUsd.toFixed(2)}</strong></span>}
        <span>Source<strong>{entry.source}</strong></span>
        {entry.origin === "aura" && <span>Reference<strong>{entry.id}</strong></span>}
        {entry.failureReason && <span>Reason<strong>{entry.failureReason}</strong></span>}
      </div>
      {entry.origin === "aura" ? <ReceiptJourney id={entry.id} />
        : entry.origin === "incoming" ? <p className="modalRisk" data-testid="incoming-finality">{entry.status === "completed"
          ? `Final on ${networkName(entry.chainId)}.` : `Arrived. Waiting for ${networkName(entry.chainId)} to make it final, which usually takes a few minutes.`}</p> : null}
      {entry.origin === "aura" && <Link className="button secondary full" href={`/app/transactions/${entry.id}`}>Full history</Link>}
      {links.map((link) => <a className="button secondary full" key={link.name} href={link.url!} target="_blank" rel="noreferrer">{link.name} <ExternalLink size={14} /></a>)}
      {!links.length && <div className="modalRisk">No transaction has been recorded for this yet.</div>}
    </section>
  </div>;
}

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
  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="financialModal exportModal" role="dialog" aria-modal="true" aria-labelledby="export-title">
      <button className="modalClose" onClick={onClose} aria-label="Close"><X size={18} /></button>
      <h2 id="export-title">Export</h2>
      <p>Download the {entries.length} transactions in your list, or a full month.</p>
      <div className="exportChoices">
        <button className="exportChoice" onClick={() => save(`aura-transactions-${date}.csv`, entriesCsv(entries, networkName))}><Download size={18} /><span><strong>This list</strong><small>The transactions shown, with your filters</small></span></button>
        <button className="exportChoice" onClick={() => save(`aura-tax-support-${date}.csv`, entriesCsv(entries, networkName, tax))}><FileSpreadsheet size={18} /><span><strong>Tax-support preview</strong><small>The same list; cost basis isn&apos;t available</small></span></button>
      </div>
      <div className="statementPicker">
        <label>Monthly statement<input type="month" value={month} max={new Date().toISOString().slice(0, 7)} onChange={(event) => setMonth(event.target.value)} /></label>
        <button className="button secondary" onClick={downloadStatement} disabled={statement.state === "loading" || !month}>{statement.state === "loading" ? <LoaderCircle className="spin" size={14} /> : <Download size={14} />} Download</button>
      </div>
      {statement.state === "error" && <div className="formError" role="alert">{statement.message}</div>}
      <div className="modalRisk"><ShieldCheck size={15} /> These files support record keeping. They aren&apos;t bank statements, tax returns, or tax advice.</div>
    </section>
  </div>;
}

export function ActivityWorkspace() {
  const { user } = usePrivy();
  const api = useApi();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof CATEGORIES)[number]>("All");
  const [status, setStatus] = useState<(typeof STATUSES)[number]>("All");
  const [chosen, setChosen] = useState<ActivityEntry | null>(null);
  // A link from Send or Swap opens the transaction straight away: /app/transactions?open=<action id>.
  const [openId, setOpenId] = useState(useSearchParams().get("open"));
  const [exportOpen, setExportOpen] = useState(false);
  const query = useQuery({ queryKey: ["activity", user?.id], queryFn: () => api<History>("/api/activity"), enabled: Boolean(user), refetchInterval: 30_000 });
  const entries = useMemo(() => query.data?.entries ?? [], [query.data]);
  const selected = chosen ? entries.find((entry) => entry.id === chosen.id) ?? chosen : entries.find((entry) => entry.id === openId) ?? null;
  const close = () => { setChosen(null); setOpenId(null); };
  const filtered = useMemo(() => entries.filter((entry) => {
    const needle = search.trim().toLowerCase();
    return (category === "All" || entryCategory(entry.type) === category) && (status === "All" || statusLabel(entry.status) === status)
      && (!needle || [entryLabel(entry.type), entry.asset, entry.toAsset, entry.amount, entry.counterparty, entry.transactionHash].some((value) => value?.toLowerCase().includes(needle)));
  }), [entries, category, status, search]);
  const sources = query.data?.sources;

  return <>
    <section className="panel widePanel activityWorkspace">
      <div className="panelHeading"><div><h2>Activity</h2></div><button className="button secondary small" onClick={() => setExportOpen(true)} disabled={!query.data}><Download size={14} /> Export</button></div>
      {sources?.incoming.status === "unavailable" && <div className="formWarning" role="status">Money you received can&apos;t be read right now, so some deposits may be missing from this list.</div>}
      {sources?.incoming.partial && <div className="formWarning" role="status">Only your most recent deposits are listed. Use a monthly statement for a full month.</div>}
      {sources?.aave.status === "unavailable" && <div className="formWarning" role="status">Aave history can&apos;t be read right now.</div>}
      <div className="activityFilters">
        <label className="activitySearch"><Search size={15} /><span className="srOnly">Search activity</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label>
        <label><span className="srOnly">Category</span><select value={category} onChange={(event) => setCategory(event.target.value as typeof category)}>{CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
        <label><span className="srOnly">Status</span><select value={status} onChange={(event) => setStatus(event.target.value as typeof status)}>{STATUSES.map((item) => <option key={item}>{item}</option>)}</select></label>
      </div>
      <div className="activityList expanded">{query.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={18} /><strong>Checking activity</strong></div>
        : query.isError ? <div className="formError">Activity couldn&apos;t be loaded. Try again.</div>
          : filtered.length === 0 ? <div className="emptyState"><Search size={22} /><strong>{entries.length ? "No matching activity" : "No activity yet"}</strong><span>{entries.length ? "Try changing the filters." : "Money you send, receive, swap, or earn will appear here."}</span></div>
            : filtered.map((entry) => <button className="activityRow activityButton" key={entry.id} data-testid={`entry-${entry.id}`} onClick={() => setChosen(entry)}>
              <span className={`activityIcon ${tone(entry)}`}>{entry.type === "received" && entry.status === "completed" ? <ArrowDownLeft size={14} /> : <StatusIcon entry={entry} />}</span>
              <span><strong>{entryLabel(entry.type)}</strong><small>{new Date(entry.createdAt).toLocaleString()} · {networkName(entry.chainId)}{entry.counterparty ? ` · ${short(entry.counterparty)}` : ""}</small></span>
              <span className="activityAmount"><strong>{entryAmount(entry) ?? "—"}</strong><small className={`intentState ${entry.status}`}>{statusLabel(entry.status)}</small></span>
            </button>)}</div>
      <p className="authorityFootnote">Your Aura transactions are checked against the network. Money you received comes from Alchemy&apos;s record of the network, and Aave history from Aave.</p>
    </section>
    {exportOpen && <ExportDialog entries={filtered} onClose={() => setExportOpen(false)} />}
    {selected && <Receipt entry={selected} onClose={close} />}
  </>;
}
