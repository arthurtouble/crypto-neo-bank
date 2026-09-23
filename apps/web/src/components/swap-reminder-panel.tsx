"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useEffect, useState } from "react";
import type { ReminderPlan } from "@/lib/swap/reminder-store";
import { reminderDisabledText, reviewableReminder, type ReviewableOccurrence } from "@/lib/swap/reminder-view-model";

type Due = ReviewableOccurrence & { occurrenceId: string; dueAt: string };
type Props = { fromAssetId: string; toAssetId: string; amount: string; onReview(value: { fromAssetId: string; toAssetId: string; amount: string }): void };
type Schedule = "one_time" | "weekly" | "monthly";

function localStart() {
  const local = new Date(Date.now() + 3_600_000);
  return new Date(local.getTime() - local.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}
function dateLabel(value: string | null) {
  if (!value) return "No upcoming time";
  return new Date(value).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function SwapReminderPanel({ fromAssetId, toAssetId, amount, onReview }: Props) {
  const { getAccessToken } = usePrivy();
  const [plans, setPlans] = useState<ReminderPlan[]>([]);
  const [due, setDue] = useState<Due[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState<ReminderPlan | null>(null);
  const [scheduleType, setScheduleType] = useState<Schedule>("one_time");
  const [anchorLocal, setAnchorLocal] = useState(localStart);
  const [savedAmount, setSavedAmount] = useState("");

  async function api(path: string, method = "GET", body?: unknown) {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to manage reminders.");
    const response = await fetch(path, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: "no-store" });
    if (!response.ok) throw new Error(response.status === 409 ? "This reminder changed elsewhere. Refresh and try again." : response.status === 423 ? "Your account is locked." : "Reminders are unavailable. Try again.");
    return response.json();
  }
  async function refresh() {
    const [listed, materialized] = await Promise.all([api("/api/swap/reminders"), api("/api/swap/reminders/due")]);
    setPlans((listed as { plans: ReminderPlan[] }).plans);
    setDue((materialized as { occurrences: Due[] }).occurrences);
  }
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) throw new Error("Sign in to manage reminders.");
        const headers = { Authorization: `Bearer ${token}` };
        const listed = await fetch("/api/swap/reminders", { headers, cache: "no-store" });
        if (!listed.ok) throw new Error("Reminders are unavailable. Try again.");
        if (active) setPlans(((await listed.json()) as { plans: ReminderPlan[] }).plans);
        const materialized = await fetch("/api/swap/reminders/due", { headers, cache: "no-store" });
        if (!materialized.ok) throw new Error("Due reminders are unavailable. Saved plans remain visible.");
        if (active) {
          setDue(((await materialized.json()) as { occurrences: Due[] }).occurrences);
        }
      } catch (caught) { if (active) setError(caught instanceof Error ? caught.message : "Reminders are unavailable."); }
      finally { if (active) setLoading(false); }
    })();
    return () => { active = false; };
  }, [getAccessToken]);

  async function createOrEdit(event: React.FormEvent) {
    event.preventDefault(); setBusy(true); setError(null); setNotice(null);
    try {
      if (!/^\d+(?:\.\d+)?$/.test(savedAmount) || !/[1-9]/.test(savedAmount)) throw new Error("Enter an amount greater than zero.");
      if (!anchorLocal) throw new Error("Choose a reminder time.");
      const fields = { amount: savedAmount, scheduleType, timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone, anchorLocal };
      if (editing) await api("/api/swap/reminders", "PATCH", { ...fields, planId: editing.planId, version: editing.planVersion, action: "edit" });
      else await api("/api/swap/reminders", "POST", { ...fields, fromAssetId, toAssetId });
      setEditing(null); setNotice(editing ? "Reminder updated." : "Reminder saved. No trade was placed.");
      try { await refresh(); } catch { setError("Saved, but the list could not refresh. Please try again later."); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save reminder."); }
    finally { setBusy(false); }
  }
  async function change(plan: ReminderPlan, action: "pause" | "resume" | "cancel") {
    setBusy(true); setError(null); setNotice(null);
    try {
      await api("/api/swap/reminders", "PATCH", { planId: plan.planId, version: plan.planVersion, action });
      setNotice(`Reminder ${action === "cancel" ? "cancelled" : action === "pause" ? "paused" : "resumed"}.`);
      try { await refresh(); } catch { setError("Updated, but the list could not refresh. Please try again later."); }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not update reminder."); }
    finally { setBusy(false); }
  }
  async function reviewDue(occurrence: Due) {
    setBusy(true); setError(null);
    try {
      const fresh = await api("/api/swap/reminders/due") as { occurrences: Due[] };
      setDue(fresh.occurrences);
      const current = fresh.occurrences.find((item) => item.occurrenceId === occurrence.occurrenceId);
      const selection = current && reviewableReminder(current);
      if (!selection) throw new Error("This reminder is no longer available for review.");
      onReview(selection);
      setNotice("Pair and amount loaded. Request a fresh route to review current terms; no trade was placed.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Review is unavailable."); }
    finally { setBusy(false); }
  }

  return <section className="swapReminders" aria-labelledby="swapRemindersTitle">
    <div className="swapRemindersHeading"><div><h3 id="swapRemindersTitle">Swap reminders</h3><p>Reminders bring you back to review a live route. They never place a trade.</p></div><button type="button" className="button secondary" disabled={busy} onClick={() => { setEditing(null); setSavedAmount(amount); setAnchorLocal(localStart()); }}>New reminder</button></div>
    {error && <p className="formError" role="alert">{error} <button type="button" onClick={() => { setError(null); void refresh().catch(() => setError("Reminders are unavailable. Try again.")); }}>Try again</button></p>}
    {notice && <p role="status" className="formSuccess">{notice}</p>}
    <form className="swapReminderForm" onSubmit={(event) => void createOrEdit(event)}>
      <strong>{editing ? "Edit reminder" : "Remind me about this pair"}</strong>
      <p>{editing ? `${editing.fromAssetId} → ${editing.toAssetId}` : `${fromAssetId} → ${toAssetId}`}</p>
      <label>Amount<input aria-label="Reminder amount" inputMode="decimal" value={savedAmount} onChange={(event) => setSavedAmount(event.target.value)} required /></label>
      <label>Repeat<select value={scheduleType} onChange={(event) => setScheduleType(event.target.value as Schedule)}><option value="one_time">Once</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label>
      <label>First reminder<input type="datetime-local" value={anchorLocal} onChange={(event) => setAnchorLocal(event.target.value)} required /></label>
      <button className="button secondary" type="submit" disabled={busy || !savedAmount}>{busy ? "Saving…" : editing ? "Save changes" : "Save reminder"}</button>
      {editing && <button className="button secondary" type="button" onClick={() => setEditing(null)}>Cancel edit</button>}
    </form>
    {loading ? <p role="status">Loading reminders…</p> : <>
      <h4>Due now</h4>
      {due.length === 0 ? <p>No reminders are due.</p> : <ul className="swapReminderList">{due.map((item) => <li key={item.occurrenceId}><div><strong>{item.amount} · {item.fromAssetId} → {item.toAssetId}</strong><small>Due {dateLabel(item.dueAt)}</small>{!item.canReview && <small>{reminderDisabledText(item.disabledReason)}</small>}</div><button className="button secondary" type="button" disabled={busy || !item.canReview} onClick={() => void reviewDue(item)}>Review Swap</button></li>)}</ul>}
      <h4>Saved plans</h4>
      {plans.length === 0 ? <p>No saved reminders yet.</p> : <ul className="swapReminderList">{plans.map((plan) => <li key={plan.planId}><div><strong>{plan.amount} · {plan.fromAssetId} → {plan.toAssetId}</strong><small>{plan.scheduleType.replace("_", " ")} · {plan.status} · Next {dateLabel(plan.nextDueAt)}</small></div><div className="swapReminderActions"><button type="button" disabled={busy || plan.status !== "active"} onClick={() => { setEditing(plan); setSavedAmount(plan.amount); setScheduleType(plan.scheduleType); setAnchorLocal(plan.anchorLocal); }}>Edit</button><button type="button" disabled={busy} onClick={() => void change(plan, plan.status === "active" ? "pause" : "resume")}>{plan.status === "active" ? "Pause" : "Resume"}</button><button type="button" disabled={busy} onClick={() => void change(plan, "cancel")}>Cancel</button></div></li>)}</ul>}
    </>}
  </section>;
}
