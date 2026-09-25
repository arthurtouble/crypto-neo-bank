"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Check, Clock3, Download, ExternalLink, FileSpreadsheet, LoaderCircle, Search, ShieldCheck, X, XCircle } from "lucide-react";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { activityCategory, activityCsv, activityEventLabel, activityLabel, activityStatus, taxSupportCsv, type ActivityCategory } from "@/lib/activity/presentation";

type Intent = { intentId: string; type: string; status: string; transactionHash?: string; createdAt: string; updatedAt?: string; confirmedAt?: string; failureReason?: string; chainId?: number; asset?: string; amount?: string; destination?: string; estimatedUsd?: number; routeReference?: string; source?: string; sourceKind?: "projection" | "chain" | "provider"; authority?: string; events?: Array<{ type: string; occurredAt: string }> };
type Observation = { reportId: string; intentId: string; stepIndex: number; chainId: number; transactionHash: string; status: string; reportedAt: string; lastCheckedAt: string | null };
type ActivityResponse = { intents: Intent[]; observations: Observation[]; observedAt: string; sources: { aurel: { status: string; count: number; authority: string }; aave: { status: "available" | "none" | "unavailable"; count: number; partial: boolean; authority: string } } };
const explorers: Record<number, string> = { 1: "https://etherscan.io", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com", 8453: "https://basescan.org", 42161: "https://arbiscan.io" };
const categories: Array<"All" | ActivityCategory> = ["All", "Transfers", "Earn", "Borrow", "Swaps", "Other"];

function short(value?: string) { return value && value.length > 14 ? `${value.slice(0, 7)}…${value.slice(-5)}` : value; }

export function ActivityWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const { address } = useAuraWallet();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<(typeof categories)[number]>("All");
  const [status, setStatus] = useState("All");
  const [selected, setSelected] = useState<Intent | null>(null);
  const [exportOpen, setExportOpen] = useState(false);
  const query = useQuery<ActivityResponse>({
    queryKey: ["full-activity", user?.id, address],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch(`/api/activity${address ? `?address=${address}` : ""}`, { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
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

  const exportRows = filtered.map((item) => ({ createdAt: item.createdAt, label: activityLabel(item.type), category: activityCategory(item.type), status: activityStatus(item.status), amount: item.amount, asset: item.asset, destination: item.destination, transactionHash: item.transactionHash, chainId: item.chainId, estimatedUsd: item.estimatedUsd, source: item.source, authority: item.authority }));
  const chainRecords = filtered.filter((item) => item.sourceKind === "chain").length;
  const receiptRecords = filtered.filter((item) => Boolean(item.transactionHash)).length;
  const valuedRecords = filtered.filter((item) => item.estimatedUsd !== undefined).length;

  function download(kind: "activity" | "tax") {
    const csv = kind === "tax" ? taxSupportCsv(exportRows) : activityCsv(exportRows);
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `aura-${kind === "tax" ? "tax-support" : "activity"}-${new Date().toISOString().slice(0, 10)}.csv`; anchor.click(); URL.revokeObjectURL(url);
  }


  return <>
    <section className="panel widePanel activityWorkspace">
      <div className="panelHeading"><div><h2>Activity</h2></div><button className="button secondary small" onClick={() => setExportOpen(true)}><Download size={14} /> Export</button></div>
      {query.data?.observations?.length ? <section className="activityObservations" aria-labelledby="activity-observations-title"><h3 id="activity-observations-title">Transfers requiring review</h3><p>These network observations are separate from approved Aura activity.</p><div className="activityList expanded">{query.data.observations.map((item) => <div className="activityRow" key={item.reportId}><span className="activityIcon neutral"><ShieldCheck size={14} /></span><span><strong>Transfer observation</strong><small>{new Date(item.reportedAt).toLocaleString()} · {item.chainId === 8453 ? "Base" : `Chain ${item.chainId}`} · {short(item.transactionHash)}</small></span><span className="activityAmount"><strong>{item.status}</strong>{explorers[item.chainId] && /^0x[a-f\d]{64}$/i.test(item.transactionHash) ? <a href={`${explorers[item.chainId]}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer" aria-label={`View observed transfer ${short(item.transactionHash)} on network explorer`}>View transaction <ExternalLink size={12} /></a> : null}</span></div>)}</div></section> : null}
      <div className="activityFilters"><label className="activitySearch"><Search size={15} /><span className="srOnly">Search activity</span><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search activity" /></label><label><span className="srOnly">Category</span><select value={category} onChange={(event) => setCategory(event.target.value as (typeof categories)[number])}>{categories.map((item) => <option key={item}>{item}</option>)}</select></label><label><span className="srOnly">Status</span><select value={status} onChange={(event) => setStatus(event.target.value)}><option>All</option><option>Completed</option><option>Pending</option><option>Awaiting approval</option><option>Failed</option><option>Cancelled</option></select></label></div>
      <div className="activityList expanded">{query.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={18} /><strong>Checking activity</strong></div> : query.isError ? <div className="formError">{query.error.message}</div> : filtered.length === 0 ? <div className="emptyState"><Search size={22} /><strong>{query.data.intents.length ? "No matching activity" : "No activity yet"}</strong><span>{query.data.intents.length ? "Try changing the filters." : "Completed and pending actions will appear here."}</span></div> : filtered.map((item) => {
        const displayStatus = activityStatus(item.status); const Icon = displayStatus === "Completed" ? Check : displayStatus === "Failed" || displayStatus === "Cancelled" ? XCircle : Clock3;
        return <button className="activityRow activityButton" key={item.intentId} onClick={() => setSelected(item)}><span className={`activityIcon ${displayStatus === "Completed" ? "good" : displayStatus === "Failed" ? "bad" : "neutral"}`}><Icon size={14} /></span><span><strong>{activityLabel(item.type)}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.source ?? activityCategory(item.type)}{item.destination ? ` · ${short(item.destination)}` : ""}</small></span><span className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "—"}</strong><small className={`intentState ${item.status}`}>{displayStatus}</small></span></button>;
      })}</div>
      <p className="authorityFootnote">Activity combines Aura workflow evidence with available provider and network records.</p>
      <p className="authorityFootnote">Question about a card charge? <Link href="/app/support?topic=card-charge">Open a support case</Link>. Issuer dispute submission becomes available when a card transaction feed and issuer case adapter are connected.</p>
    </section>
    {exportOpen && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setExportOpen(false)}><section className="financialModal exportModal" role="dialog" aria-modal="true" aria-labelledby="export-title"><button className="modalClose" onClick={() => setExportOpen(false)} aria-label="Close"><X size={18} /></button><h2 id="export-title">Export Activity</h2><p>Download the {filtered.length} records in your current displayed activity page. Aura intents are capped at the latest 50; this is not complete historical or tax coverage.</p><div className="exportCoverage"><span><strong>{receiptRecords}</strong><small>Network receipts</small></span><span><strong>{chainRecords}</strong><small>Protocol records</small></span><span><strong>{valuedRecords}</strong><small>USD estimates</small></span></div><div className="exportChoices"><button className="exportChoice" onClick={() => download("activity")}><Download size={18} /><span><strong>Activity CSV</strong><small>Current displayed page only</small></span></button><button className="exportChoice" onClick={() => download("tax")}><FileSpreadsheet size={18} /><span><strong>Activity tax-support preview CSV</strong><small>Current page; missing cost basis remains unavailable</small></span></button></div><div className="modalRisk"><ShieldCheck size={15} /> These files support record keeping. They are not bank statements, tax returns or tax advice.</div>{query.data?.sources.aave.status === "unavailable" && <div className="formWarning">Aave activity is temporarily unavailable, so this export contains Aura records only.</div>}{query.data?.sources.aave.partial && <div className="formWarning">The Aave source returned a partial page. Older protocol history may not be included.</div>}</section></div>}
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal receiptModal" role="dialog" aria-modal="true" aria-labelledby="receipt-title"><button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button><div className={`receiptStatus ${selected.status}`}><Check size={19} /></div><h2 id="receipt-title">{activityLabel(selected.type)}</h2><strong className="receiptAmount">{selected.amount ? `${selected.amount} ${selected.asset ?? ""}` : activityStatus(selected.status)}</strong><div className="receiptDetails"><span>Status<strong>{activityStatus(selected.status)}</strong></span><span>Date<strong>{new Date(selected.createdAt).toLocaleString()}</strong></span><span>Category<strong>{activityCategory(selected.type)}</strong></span><span>Source<strong>{selected.source ?? "Aura"}</strong></span>{selected.destination && <span>Destination<strong>{short(selected.destination)}</strong></span>}<span>Reference<strong>{selected.intentId.slice(0, 12)}</strong></span>{selected.failureReason && <span>Reason<strong>{selected.failureReason}</strong></span>}</div>{selected.events?.length ? <div className="receiptTimeline"><h3>Timeline</h3>{selected.events.map((event, index) => <div key={`${event.type}-${event.occurredAt}-${index}`}><i /><span><strong>{activityEventLabel(event.type)}</strong><small>{new Date(event.occurredAt).toLocaleString()}</small></span></div>)}</div> : null}{selected.source === "Aura" && <Link className="button secondary full" href={`/app/transactions/${selected.intentId}`}>Full history</Link>}{selected.transactionHash ? <a className="button secondary full" href={`${explorers[selected.chainId ?? 8453] ?? explorers[8453]}/tx/${selected.transactionHash}`} target="_blank" rel="noreferrer">View Transaction <ExternalLink size={14} /></a> : <div className="modalRisk">No transaction hash has been recorded for this action.</div>}</section></div>}
  </>;
}
