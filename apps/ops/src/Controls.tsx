import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, when } from "./api";

type Flag = { flag_key: string; enabled: number; updated_at: string; updated_by: string };
type Asset = { id: string; symbol: string; name: string; chainId: number; paused: { reason: string; at: string; by: string } | null };
type Issue = { issue_id: string; issue_type: string; severity: string; source_name: string; summary: string; status: string; opened_at: string };
type Summary = { issues: Issue[]; webhooks: Array<{ status: string; count: number }>; checks: Array<{ check_key: string; status: string; checked_at: string }> };

const flagText: Record<string, string> = {
  direct_transfers: "Send", swaps: "Swap", cross_chain: "Other networks (send, swap, deposit)", defi_actions: "Earn",
  fiat_accounts: "Bank (Bridge)", payment_cards: "Cards (Stripe with Bridge)", card_wallets: "Apple Pay and Google Pay"
};
const networks: Record<number, string> = { 1: "Ethereum", 8453: "Base", 10: "Optimism", 137: "Polygon", 42161: "Arbitrum" };

function Switches() {
  const client = useQueryClient();
  const flags = useQuery({ queryKey: ["flags"], queryFn: () => api<{ flags: Flag[] }>("features") });
  const toggle = useMutation({ mutationFn: (flag: Flag) => api("features", { method: "PATCH", json: { key: flag.flag_key, enabled: !flag.enabled } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["flags"] }) });
  return <section className="panel" aria-labelledby="switches-heading"><h2 id="switches-heading">Feature switches</h2>
    <p className="muted">Off stops new actions at once, on the server. Anything already on its way keeps settling.</p>
    {flags.isError && <div className="notice error" role="alert">{flags.error.message}</div>}
    {toggle.isError && <div className="notice error" role="alert">{toggle.error.message}</div>}
    <ul className="rows">{flags.data?.flags.map((flag) => <li key={flag.flag_key}>
      <div><strong>{flagText[flag.flag_key] ?? flag.flag_key}</strong><span className="muted"><code>{flag.flag_key}</code>, changed {when(flag.updated_at)} by {flag.updated_by}</span></div>
      <button className={`toggle ${flag.enabled ? "on" : ""}`} role="switch" aria-checked={Boolean(flag.enabled)} aria-label={flagText[flag.flag_key] ?? flag.flag_key}
        disabled={toggle.isPending} onClick={() => toggle.mutate(flag)}>{flag.enabled ? "On" : "Off"}</button></li>)}</ul>
  </section>;
}

function Pauses() {
  const client = useQueryClient();
  const assets = useQuery({ queryKey: ["assets"], queryFn: () => api<{ assets: Asset[] }>("assets") });
  const [pausing, setPausing] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const change = useMutation({ mutationFn: (input: { assetId: string; paused: boolean; reason?: string }) => api("assets", { method: "PATCH", json: input }),
    onSuccess: () => { setPausing(null); setReason(""); void client.invalidateQueries({ queryKey: ["assets"] }); } });
  return <section className="panel" aria-labelledby="pauses-heading"><h2 id="pauses-heading">Asset pauses</h2>
    <p className="muted">A paused asset can&apos;t be deposited, sent, swapped, or bought. Customers still see what they hold. Adding an asset is a reviewed code change.</p>
    {assets.isError && <div className="notice error" role="alert">{assets.error.message}</div>}
    {change.isError && <div className="notice error" role="alert">{change.error.message}</div>}
    <ul className="rows">{assets.data?.assets.map((asset) => <li key={asset.id} data-testid="ops-asset">
      <div><strong>{asset.symbol} <span className="muted">on {networks[asset.chainId] ?? asset.chainId}</span></strong>
        <span className="muted">{asset.paused ? `Paused ${when(asset.paused.at)} by ${asset.paused.by}: ${asset.paused.reason}` : asset.name}</span></div>
      {asset.paused ? <button className="button" disabled={change.isPending} onClick={() => change.mutate({ assetId: asset.id, paused: false })}>Resume</button>
        : pausing === asset.id ? <form className="reason" aria-label={`Pause ${asset.symbol}`} onSubmit={(event) => { event.preventDefault(); change.mutate({ assetId: asset.id, paused: true, reason: reason.trim() }); }}>
          <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>
          <button className="button primary" disabled={change.isPending || !reason.trim()}>Pause</button>
          <button type="button" className="button quiet" onClick={() => setPausing(null)}>Cancel</button></form>
          : <button className="button" onClick={() => { setPausing(asset.id); setReason(""); }}>Pause</button>}
    </li>)}</ul>
  </section>;
}

function Issues() {
  const client = useQueryClient();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("summary") });
  const reconcile = useMutation({ mutationFn: () => api<{ checked: number; openedCandidates: number }>("reconcile", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["summary"] }) });
  const update = useMutation({ mutationFn: ({ id, status }: { id: string; status: "acknowledged" | "resolved" }) => api(`issues/${id}`, { method: "PATCH", json: { status } }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["summary"] }) });
  const data = summary.data;
  return <section className="panel" aria-labelledby="issues-heading">
    <div className="headingRow"><h2 id="issues-heading">Issues</h2>
      <button className="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>{reconcile.isPending ? "Checking…" : "Look for stuck actions and failed events"}</button></div>
    {reconcile.data && <div className="notice" role="status">Checked {reconcile.data.checked}; {reconcile.data.openedCandidates} found.</div>}
    {(summary.isError || update.isError || reconcile.isError) && <div className="notice error" role="alert">{(summary.error ?? update.error ?? reconcile.error)!.message}</div>}
    <ul className="rows">{data?.issues.map((issue) => <li key={issue.issue_id} data-testid="ops-issue">
      <div><strong><span className={`badge ${issue.severity === "critical" || issue.severity === "high" ? "bad" : "warn"}`}>{issue.severity}</span> {issue.summary}</strong>
        <span className="muted">{issue.issue_type.replaceAll("_", " ")} from {issue.source_name}, opened {when(issue.opened_at)}, {issue.status}</span></div>
      <div className="actions">
        {issue.status === "open" && <button className="button" disabled={update.isPending} onClick={() => update.mutate({ id: issue.issue_id, status: "acknowledged" })}>Acknowledge</button>}
        <button className="button" disabled={update.isPending} onClick={() => update.mutate({ id: issue.issue_id, status: "resolved" })}>Resolve</button></div>
    </li>)}</ul>
    {data && !data.issues.length && <p className="muted">No open issues.</p>}
    {data && <p className="muted">Provider events: {data.webhooks.map((row) => `${row.count} ${row.status}`).join(", ") || "none yet"}.
      {data.checks.map((check) => ` ${check.check_key}: ${check.status} (${when(check.checked_at)}).`).join("")}</p>}
  </section>;
}

export function Controls() {
  return <div className="stack"><h1>Controls</h1><Switches /><Pauses /><Issues /></div>;
}
