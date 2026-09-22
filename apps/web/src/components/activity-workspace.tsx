"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Download, ExternalLink, LoaderCircle, Search, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { activityCategory, activityCsv, activityEventLabel, activityLabel, activityStatus, type ActivityCategory } from "@/lib/activity/presentation";

type Intent = { intentId: string; type: string; status: string; transactionHash?: string; createdAt: string; updatedAt?: string; confirmedAt?: string; failureReason?: string; chainId?: number; asset?: string; amount?: string; destination?: string; estimatedUsd?: number; routeReference?: string; events?: Array<{ type: string; occurredAt: string }> };
const explorers: Record<number, string> = { 1: "https://etherscan.io", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com", 8453: "https://basescan.org", 42161: "https://arbiscan.io" };
const categories: Array<"All" | ActivityCategory> = ["All", "Transfers", "Earn", "Borrow", "Swaps", "Other"];

function short(value?: string) { return value && value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

export function ActivityWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState<Intent | null>(null);
  const query = useQuery<{ intents: Intent[]; observedAt: string }>({
    queryKey: ["full-activity", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      if (token) await fetch("/api/intents/reconcile", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
      const response = await fetch("/api/activity", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Activity could not be loaded.");
      return response.json();
    },
    enabled: Boolean(user), refetchInterval: 30_000
  });
  const filtered = useMemo(() => (query.data?.intents ?? []).filter((item) => {
    const matchesCategory = category === "All" || activityCategory(item.type) === category;
    const matchesStatus = status === "All" || activityStatus(item.status) === status;
    const needle = search.trim().toLowerCase();
    const matchesSearch = !needle || [activityLabel(item.type), item.asset, item.amount, item.destination, item.transactionHash].some((value) => value?.toLowerCase().includes(needle));
    return matchesCategory && matchesStatus && matchesSearch;
  }), [query.data, category, status, search]);

  function download() {
    const csv = activityCsv(filtered.map((item) => ({ createdAt: item.createdAt, label: activityLabel(item.type), category: activityCategory(item.type), status: activityStatus(item.status), amount: item.amount, asset: item.asset, destination: item.destination, transactionHash: item.transactionHash })));
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `aurel-activity-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }

  return <>
    <section className="panel widePanel activityWorkspace">
      <div className="panelHeading"><div><h2>Activity</h2></div><button className="button secondary small" onClick={download} disabled={filtered.length === 0}><Download size={14} /> Export</button></div>
      <div className="activityFilters"><label className="activitySearch"><Search size={15} /><span className="srOnly">Search activity</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label><label><span className="srOnly">Category</span><select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="srOnly">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option><option>Completed</option><option>Pending</option><option>Awaiting approval</option><option>Failed</option><option>Cancelled</option></select></label></div>
      <div className="activityList expanded">{query.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={18} /><strong>Checking activity</strong></div> : query.isError ? <div className="formError">{query.error.message}</div> : filtered.length === 0 ? <div className="emptyState"><Search size={22} /><strong>{query.data.intents.length ? "No matching activity" : "No activity yet"}</strong><span>{query.data.intents.length ? "Try changing the filters." : "Completed and pending actions will appear here."}</span></div> : filtered.map((item) => {
        const displayStatus = activityStatus(item.status); const Icon = displayStatus === "Completed" ? Check : displayStatus === "Failed" || displayStatus === "Cancelled" ? XCircle : Clock3;
        return <button className="activityRow activityButton" key={item.intentId} onClick={() => setSelected(item)}><span className={`activityIcon ${displayStatus === "Completed" ? "good" : displayStatus === "Failed" ? "bad" : "neutral"}`}><Icon size={14} /></span><span><strong>{activityLabel(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString()} · {activityCategory(item.type)}{item.destination ? ` · ${short(item.destination)}` : ""}</small></span><span className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "—"}</strong><small className={`intentState ${item.status}`}>{displayStatus}</small></span></button>;
      })}</div>
      <p className="authorityFootnote">This export is an Aurel activity record, not a bank or tax statement. Providers and blockchains remain authoritative.</p>
    </section>
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal receiptModal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button><div className={`receiptStatus ${selected.status}`}><Check size={19} /></div><h2 id="receipt-title">{activityLabel(selected.type)}</h2><strong className="receiptAmount">{selected.amount ? `${selected.amount} ${selected.asset ?? ""}` : activityStatus(selected.status)}</strong><div className="receiptDetails"><span>Status<strong>{activityStatus(selected.status)}</strong></span><span>Date<strong>{new Date(selected.createdAt).toLocaleString()}</strong></span><span>Category<strong>{activityCategory(selected.type)}</strong></span>{selected.destination && <span>Destination<strong>{short(selected.destination)}</strong></span>}<span>Reference<strong>{selected.intentId.slice(0, 12)}</strong></span>{selected.failureReason && <span>Reason<strong>{selected.failureReason}</strong></span>}</div>{selected.events?.length ? <div className="receiptTimeline"><h3>Timeline</h3>{selected.events.map((event, index) => <div key={`${event.type}-${event.occurredAt}-${index}`}><i /><span><strong>{activityEventLabel(event.type)}</strong><small>{new Date(event.occurredAt).toLocaleString()}</small></span></div>)}</div> : null}{selected.transactionHash ? <a className="button secondary full" href={`${explorers[selected.chainId ?? 8453] ?? explorers[8453]}/tx/${selected.transactionHash}`} target="_blank" rel="noreferrer">View Transaction <ExternalLink size={14} /></a> : <div className="modalRisk">No transaction hash has been recorded for this action.</div>}</section></div>}
  </>;
}
