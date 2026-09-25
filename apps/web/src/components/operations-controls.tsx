"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Flag, Users } from "lucide-react";

type FlagData = { flags: Array<{ flag_key: string; enabled: number; audience: string; updated_at: string }> };
type AnalyticsData = { customers: { total?: number; new_30d?: number }; events: Array<{ event_name: string; events: number; customers: number }>; transactions: Array<{ status: string; count: number }>; support: Array<{ status: string; priority: string; count: number }>; feedback: Array<{ sentiment: string; category: string; count: number }> };

export function OperationsControls() {
  const { getAccessToken } = usePrivy();
  const client = useQueryClient();
  async function authFetch(path: string, init?: RequestInit) { const token = await getAccessToken(); return fetch(path, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) }, cache: "no-store" }); }
  const flags = useQuery<FlagData>({ queryKey: ["ops-flags"], queryFn: async () => { const response = await authFetch("/api/ops/features"); if (!response.ok) throw new Error(); return response.json(); } });
  const analytics = useQuery<AnalyticsData>({ queryKey: ["ops-analytics"], queryFn: async () => { const response = await authFetch("/api/ops/analytics"); if (!response.ok) throw new Error(); return response.json(); } });
  async function toggleFlag(key: string, enabled: boolean, audience: string) { await authFetch("/api/ops/features", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key, enabled, audience: audience === "operations" ? "operations" : "all" }) }); await client.invalidateQueries({ queryKey: ["ops-flags"] }); }
  if (flags.isError || analytics.isError) return null;
  return <div className="operationsControls"><section className="panel opsAnalytics"><div className="panelHeading"><div><p className="eyebrow">LAST 30 DAYS</p><h2>Customer and product signals</h2></div><Users size={19} /></div><div className="opsMetrics compact"><div><span>Customers</span><strong>{analytics.data?.customers.total ?? 0}</strong><small>{analytics.data?.customers.new_30d ?? 0} new</small></div><div><span>Submitted</span><strong>{analytics.data?.transactions.find((item) => item.status === "submitted")?.count ?? 0}</strong><small>transaction intents</small></div><div><span>Confirmed</span><strong>{analytics.data?.transactions.find((item) => item.status === "confirmed")?.count ?? 0}</strong><small>source receipts</small></div><div><span>Support</span><strong>{analytics.data?.support.reduce((sum, item) => sum + Number(item.count), 0) ?? 0}</strong><small>cases opened</small></div></div></section>
    <section className="panel flagManager"><div className="panelHeading"><div><p className="eyebrow">KILL SWITCHES</p><h2>Feature availability</h2></div><Flag size={19} /></div>{flags.data?.flags.map((flag) => <div className="flagRow" key={flag.flag_key}><span><strong>{flag.flag_key.replaceAll("_", " ")}</strong><small>{flag.audience} · {new Date(flag.updated_at).toLocaleString()}</small></span><button className={`settingsToggle ${flag.enabled ? "active" : ""}`} onClick={() => void toggleFlag(flag.flag_key, !flag.enabled, flag.audience)}>{flag.enabled ? "On" : "Off"}</button></div>)}</section></div>;
}
