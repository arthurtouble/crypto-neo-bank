import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api, when, words } from "./api";
import { ErrorNotice } from "./Notice";

type Issue = { issue_id: string; subject_reference: string | null; issue_type: string; severity: string; source_name: string; source_reference: string | null; summary: string;
  status: string; opened_at: string };
export type Summary = { issues: Issue[]; webhooks: Array<{ status: string; count: number }>;
  checks: Array<{ check_key: string; status: string; checked_at: string; details: { label?: string } }> };

const issueTypes: Record<string, string> = { stale_action: "Stuck action", webhook_failed: "Provider event failed", webhook_stalled: "Provider event stuck",
  webhook_dead_letter: "Provider event dropped", dependency_unavailable: "Service unavailable" };
const eventStatus: Record<string, string> = { received: "received", enqueued: "waiting", processed: "applied", failed: "failed" };

/** Open issues, shared with the sidebar's count. */
export const useSummary = () => useQuery({ queryKey: ["summary"], queryFn: () => api<Summary>("summary") });

/** Stuck actions, failed provider events, and services that are down: what an operator should look at first. */
export function Issues() {
  const client = useQueryClient();
  const summary = useSummary();
  const reconcile = useMutation({ mutationFn: () => api<{ checked: number; openedCandidates: number }>("reconcile", { method: "POST" }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["summary"] }) });
  const [resolving, setResolving] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const update = useMutation({ mutationFn: ({ id, status, note }: { id: string; status: "acknowledged" | "resolved"; note?: string }) =>
    api(`issues/${id}`, { method: "PATCH", json: { status, ...(note ? { note } : {}) } }),
    onSuccess: () => { setResolving(null); setNote(""); void client.invalidateQueries({ queryKey: ["summary"] }); } });
  const data = summary.data;
  const found = reconcile.data;
  return <section className="panel" aria-labelledby="issues-heading">
    <div className="headingRow"><h1 id="issues-heading">Issues</h1>
      <button type="button" className="button" disabled={reconcile.isPending} onClick={() => reconcile.mutate()}>{reconcile.isPending ? "Checking…" : "Look for stuck actions and failed events"}</button></div>
    {found && <div className="notice" role="status">{found.openedCandidates ? `Found ${found.openedCandidates} new ${found.openedCandidates === 1 ? "issue" : "issues"}.`
      : found.checked ? "Nothing new. Everything found is already listed." : "No stuck actions or failed events found."}</div>}
    {summary.isError && <ErrorNotice error={summary.error} onRetry={() => void summary.refetch()} />}
    {update.isError && <ErrorNotice error={update.error} />}
    {reconcile.isError && <ErrorNotice error={reconcile.error} />}
    <ul className="rows">{data?.issues.map((issue) => <li key={issue.issue_id} data-testid="ops-issue">
      <div><strong><span className={`badge ${issue.severity === "critical" || issue.severity === "high" ? "bad" : "warn"}`}>{words(issue.severity)}</span> {issue.summary}</strong>
        <span className="muted">{issueTypes[issue.issue_type] ?? words(issue.issue_type)} from {words(issue.source_name)}, opened {when(issue.opened_at)}
          {issue.status === "acknowledged" ? ", acknowledged" : ""}</span>
        {issue.subject_reference && <span className="links">
          <a className="link" href={`#customers?subject=${encodeURIComponent(issue.subject_reference)}`}>Open customer</a>
          {issue.issue_type === "stale_action" && issue.source_reference
            && <a className="link" href={`#movement?subject=${encodeURIComponent(issue.subject_reference)}&action=${encodeURIComponent(issue.source_reference)}`}>Open action</a>}</span>}</div>
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
    {data && <>
      <h2>Provider events</h2>
      <p className="muted">{data.webhooks.length ? data.webhooks.map((row) => `${row.count} ${eventStatus[row.status] ?? row.status}`).join(", ") : "None yet."}</p>
      {data.checks.length > 0 && <><h2>Service checks</h2>
        <ul className="rows">{data.checks.map((check) => <li key={check.check_key}><div><strong>{check.details.label ?? words(check.check_key)}</strong>
          <span className="muted">Checked {when(check.checked_at)}</span></div>
          <span className={`badge ${check.status === "ok" || check.status === "operational" ? "good" : "bad"}`}>{check.status === "ok" || check.status === "operational" ? "Working" : words(check.status)}</span></li>)}</ul></>}
    </>}
  </section>;
}
