"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, LoaderCircle } from "lucide-react";

type Intent = { intentId: string; type: string; status: string; transactionHash?: string; createdAt: string; updatedAt?: string; confirmedAt?: string; failureReason?: string; chainId?: number; asset?: string; amount?: string };

const explorers: Record<number, string> = { 1: "https://etherscan.io", 10: "https://optimistic.etherscan.io", 137: "https://polygonscan.com", 8453: "https://basescan.org", 42161: "https://arbiscan.io" };

export function ActivityWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const query = useQuery<{ intents: Intent[]; observedAt: string }>({
    queryKey: ["full-activity", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      if (token) await fetch("/api/intents/reconcile", { method: "POST", headers: { Authorization: `Bearer ${token}` } }).catch(() => undefined);
      const response = await fetch("/api/activity", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Your audit history could not be loaded.");
      return response.json();
    },
    enabled: Boolean(user),
    refetchInterval: 30_000
  });

  return <section className="panel widePanel"><div className="panelHeading"><div><p className="eyebrow">POLICY AND SETTLEMENT</p><h2>Activity</h2><p className="sourceCaption">Submitted actions are rechecked against the source chain. Provider or chain records remain authoritative.</p></div><span className="statusBadge neutral">Last 50</span></div>
    <div className="activityList expanded">{query.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={17} /> Checking settlement…</div> : query.isError ? <div className="formError">{query.error.message}</div> : query.data.intents.length === 0 ? <div className="emptyState">No reviewed actions yet. Your first signed transfer or DeFi action will appear here.</div> : query.data.intents.map((item) => <div className="activityRow" key={item.intentId}><span className={`activityIcon ${item.status === "confirmed" ? "good" : "neutral"}`}>↗</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.chainId ? `chain ${item.chainId}` : "onchain"} · {item.failureReason ?? `Intent ${item.intentId.slice(0, 8)}`}</small></div><div className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "No amount"}</strong>{item.transactionHash ? <a href={`${explorers[item.chainId ?? 8453] ?? explorers[8453]}/tx/${item.transactionHash}`} target="_blank" rel="noreferrer"><span className={`intentState ${item.status}`}>{item.status}</span> <ExternalLink size={11} /></a> : <small className={`intentState ${item.status}`}>{item.status}</small>}</div></div>)}</div>
    <p className="authorityFootnote">Direct wallet transfers that did not originate in Aurel require an external chain-indexing provider and are not shown yet.</p>
  </section>;
}
