"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle } from "lucide-react";

type Intent = { intentId: string; type: string; status: string; transactionHash?: string; createdAt: string; asset?: string; amount?: string };

export function ActivityWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const query = useQuery<{ intents: Intent[]; observedAt: string }>({
    queryKey: ["full-activity", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/activity", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Your audit history could not be loaded.");
      return response.json();
    },
    enabled: Boolean(user),
    refetchInterval: 30_000
  });

  return <section className="panel widePanel"><div className="panelHeading"><div><p className="eyebrow">POLICY AND SIGNING AUDIT</p><h2>Reviewed actions</h2><p className="sourceCaption">This timeline records Aurel policy decisions and submitted transaction hashes. BaseScan remains authoritative for settlement.</p></div><span className="statusBadge neutral">Last 50</span></div>
    <div className="activityList expanded">{query.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={17} /> Reading audit projection…</div> : query.isError ? <div className="formError">{query.error.message}</div> : query.data.intents.length === 0 ? <div className="emptyState">No reviewed actions yet. Your first signed transfer or DeFi action will appear here.</div> : query.data.intents.map((item) => <div className="activityRow" key={item.intentId}><span className="activityIcon neutral">↗</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()} · Intent {item.intentId.slice(0, 8)}</small></div><div className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "No amount"}</strong>{item.transactionHash ? <a href={`https://basescan.org/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">{item.status} <ExternalLink size={11} /></a> : <small>{item.status}</small>}</div></div>)}</div>
    <p className="authorityFootnote">Direct wallet transfers that did not originate in Aurel require an external chain-indexing provider and are not shown yet.</p>
  </section>;
}
