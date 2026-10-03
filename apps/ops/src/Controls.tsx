import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, when } from "./api";

type Flag = { flag_key: string; enabled: number; updated_at: string; updated_by: string; reason: string | null };
type Asset = { id: string; symbol: string; name: string; chainId: number; paused: { reason: string; at: string; by: string } | null };
type Issue = { issue_id: string; subject_reference: string | null; issue_type: string; severity: string; source_name: string; source_reference: string | null; summary: string;
  status: string; opened_at: string };
type Summary = { issues: Issue[]; webhooks: Array<{ status: string; count: number }>; checks: Array<{ check_key: string; status: string; checked_at: string }> };

const flagText: Record<string, string> = {
  direct_transfers: "Send", swaps: "Swap", cross_chain: "Other networks (send, swap, deposit)", defi_actions: "Earn",
  fiat_accounts: "Bank (Bridge)", payment_cards: "Cards (Stripe with Bridge)", card_wallets: "Apple Pay and Google Pay", card_deposits: "Card deposits (Privy)"
};
const networks: Record<number, string> = { 1: "Ethereum", 8453: "Base", 10: "Optimism", 137: "Polygon", 42161: "Arbitrum" };

/** A switch changes for every customer at once, so it asks to confirm, with the reason that goes in the audit. */
function Switches() {
  const client = useQueryClient();
  const flags = useQuery({ queryKey: ["flags"], queryFn: () => api<{ flags: Flag[] }>("features") });
  const [changing, setChanging] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const toggle = useMutation({ mutationFn: (flag: Flag) => api("features", { method: "PATCH", json: { key: flag.flag_key, enabled: !flag.enabled, reason: reason.trim() } }),
    onSuccess: () => { setChanging(null); setReason(""); void client.invalidateQueries({ queryKey: ["flags"] }); } });
  return <section className="panel" aria-labelledby="switches-heading"><h2 id="switches-heading">Feature switches</h2>
    <p className="muted">Off stops new actions at once, on the server. Anything already on its way keeps settling.</p>
    {flags.isError && <div className="notice error" role="alert">{flags.error.message}</div>}
    {toggle.isError && <div className="notice error" role="alert">{toggle.error.message}</div>}
    <ul className="rows">{flags.data?.flags.map((flag) => { const name = flagText[flag.flag_key] ?? flag.flag_key; return <li key={flag.flag_key}>
      <div><strong>{name}</strong><span className="muted">Changed {when(flag.updated_at)} by {flag.updated_by}{flag.reason ? `: ${flag.reason}` : ""}</span></div>
      {changing === flag.flag_key
        ? <form className="reason" aria-label={`Turn ${flag.enabled ? "off" : "on"} ${name}`} onSubmit={(event) => { event.preventDefault(); toggle.mutate(flag); }}>
          <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>
          <button type="submit" className="button primary" disabled={toggle.isPending || reason.trim().length < 4}>{toggle.isPending ? "Working…" : `Turn ${flag.enabled ? "off" : "on"} for everyone`}</button>
          <button type="button" className="button quiet" onClick={() => setChanging(null)}>Cancel</button></form>
        : <button type="button" className={`toggle ${flag.enabled ? "on" : ""}`} role="switch" aria-checked={Boolean(flag.enabled)} aria-label={name}
          onClick={() => { toggle.reset(); setReason(""); setChanging(flag.flag_key); }}>{flag.enabled ? "On" : "Off"}</button>}</li>; })}</ul>
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
      {asset.paused ? <button type="button" className="button" disabled={change.isPending} onClick={() => change.mutate({ assetId: asset.id, paused: false })}>Resume</button>
        : pausing === asset.id ? <form className="reason" aria-label={`Pause ${asset.symbol}`} onSubmit={(event) => { event.preventDefault(); change.mutate({ assetId: asset.id, paused: true, reason: reason.trim() }); }}>
          <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} autoFocus /></label>
          <button type="submit" className="button primary" disabled={change.isPending || !reason.trim()}>Pause</button>
          <button type="button" className="button quiet" onClick={() => setPausing(null)}>Cancel</button></form>
          : <button type="button" className="button" onClick={() => { setPausing(asset.id); setReason(""); }}>Pause</button>}
    </li>)}</ul>
  </section>;
}

function Issues() {
  const client = useQueryClient();
  const summary = useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("summary") });
  const reconcile = useMutation({ mutationFn: () => api<{ checked: number; openedCandidates: number }>("reconcile", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["summary"] }) });
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const update = useMutation({ mutationFn: ({ id, status, note }: { id: string; status: "acknowledged" | "resolved"; note?: string }) =>
    api(`issues/${id}`, { method: "PATCH", json: { status, ...(note ? { note } : {}) } }),
    onSuccess: () => { setResolving(null); setNote(""); void client.invalidateQueries({ queryKey: ["summary"] }); } });
  const data = summary.data;
  return <section className="panel" aria-labelledby="issues-heading">
    <div className="headingRow"><h2 id="issues-heading">Issues</h2>
      <button type="button" className="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>{reconcile.isPending ? "Checking…" : "Look for stuck actions and failed events"}</button></div>
    {reconcile.data && <div className="notice" role="status">Checked {reconcile.data.checked}; {reconcile.data.openedCandidates} found.</div>}
    {(summary.isError || update.isError || reconcile.isError) && <div className="notice error" role="alert">{(summary.error ?? update.error ?? reconcile.error)!.message}</div>}
    <ul className="rows">{data?.issues.map((issue) => <li key={issue.issue_id} data-testid="ops-issue">
      <div><strong><span className={`badge ${issue.severity === "critical" || issue.severity === "high" ? "bad" : "warn"}`}>{issue.severity}</span> {issue.summary}</strong>
        <span className="muted">{issue.issue_type.replaceAll("_", " ")} from {issue.source_name}, opened {when(issue.opened_at)}, {issue.status}</span></div>
      {issue.subject_reference && <span className="actions">
        <a className="link" href={`#customers?subject=${encodeURIComponent(issue.subject_reference)}`}>Customer</a>
        {issue.issue_type === "stale_action" && issue.source_reference
          && <a className="link" href={`#movement?subject=${encodeURIComponent(issue.subject_reference)}&action=${encodeURIComponent(issue.source_reference)}`}>Action</a>}</span>}
      {resolving === issue.issue_id
        ? <form className="reason" aria-label="Resolve issue" onSubmit={(event) => { event.preventDefault(); update.mutate({ id: issue.issue_id, status: "resolved", note: note.trim() }); }}>
          <label>What was done<input value={note} onChange={(event) => setNote(event.target.value)} autoFocus /></label>
          <button type="submit" className="button primary" disabled={update.isPending || note.trim().length < 4}>Resolve</button>
          <button type="button" className="button quiet" onClick={() => setResolving(null)}>Cancel</button></form>
        : <div className="actions">
          {issue.status === "open" && <button type="button" className="button" disabled={update.isPending} onClick={() => update.mutate({ id: issue.issue_id, status: "acknowledged" })}>Acknowledge</button>}
          <button type="button" className="button" onClick={() => { update.reset(); setNote(""); setResolving(issue.issue_id); }}>Resolve</button></div>}
    </li>)}</ul>
    {data && !data.issues.length && <p className="muted">No open issues.</p>}
    {data && <p className="muted">Provider events: {data.webhooks.map((row) => `${row.count} ${row.status}`).join(", ") || "none yet"}.
      {data.checks.map((check) => ` ${check.check_key}: ${check.status} (${when(check.checked_at)}).`).join("")}</p>}
  </section>;
}

export function Controls() {
  return <div className="stack"><h1>Controls</h1><Switches /><Pauses /><Issues /></div>;
}
