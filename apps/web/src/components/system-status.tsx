"use client";

import { useQuery } from "@tanstack/react-query";
import { Activity, CheckCircle2, Clock3, TriangleAlert } from "lucide-react";

type StatusData = { status: string; observedAt: string; components: Array<{ key: string; label?: string; status: string; detail?: string; checkedAt: string; latencyMs?: number }>; incidents: Array<{ incident_id: string; title: string; status: string; impact: string; message: string; updated_at: string }> };

export function SystemStatus() {
  const query = useQuery<StatusData>({ queryKey: ["public-status"], queryFn: async () => { const response = await fetch("/api/status", { cache: "no-store" }); if (!response.ok) throw new Error("Live status is temporarily unavailable."); return response.json(); }, refetchInterval: 60_000, retry: 1 });
  if (query.isPending) return <section className="panel statusOverview"><Clock3 className="spin" size={20} /><div><h2>Checking systems</h2><p>Reading the latest dependency checks.</p></div></section>;
  if (query.isError) return <section className="panel statusOverview warning"><TriangleAlert size={20} /><div><h2>Status unavailable</h2><p>{query.error.message}</p></div></section>;
  const data = query.data;
  return <div className="statusWorkspace"><section className={`panel statusOverview ${data.status === "operational" ? "good" : "warning"}`}>{data.status === "operational" ? <CheckCircle2 size={22} /> : <TriangleAlert size={22} />}<div><p className="eyebrow">CURRENT STATUS</p><h2>{data.status === "operational" ? "Core systems are operating" : "One or more systems are degraded"}</h2><p>Last refreshed {new Date(data.observedAt).toLocaleString()}.</p></div></section><section className="panel componentStatus"><div className="panelHeading"><div><p className="eyebrow">DEPENDENCIES</p><h2>Live operating state</h2></div><Activity size={19} /></div>{data.components.map((component) => <div className="componentStatusRow" key={component.key}><span className={`statusDot ${component.status}`} /><div><strong>{component.label ?? component.key}</strong><small>{component.detail ?? "No additional detail"} · checked {new Date(component.checkedAt).toLocaleString()}</small></div><span className={`statusBadge ${component.status === "operational" || component.status === "configured" ? "good" : "warning"}`}>{component.status}</span></div>)}</section><section className="panel incidentHistory"><div className="panelHeading"><div><p className="eyebrow">INCIDENT HISTORY</p><h2>Published updates</h2></div></div>{data.incidents.length ? data.incidents.map((incident) => <article key={incident.incident_id}><span className="statusBadge neutral">{incident.status}</span><div><strong>{incident.title}</strong><p>{incident.message}</p><small>{incident.impact} · {new Date(incident.updated_at).toLocaleString()}</small></div></article>) : <div className="emptyState">No published incidents.</div>}</section></div>;
}

