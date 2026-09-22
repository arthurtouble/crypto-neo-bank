"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CreditCard, LoaderCircle, Pause, Play, Plus, ReceiptText, X } from "lucide-react";
import { FormEvent, useState } from "react";

type Reminder = { billId: string; name: string; category: string; expectedAmount?: string; currency: string; frequency: string; nextDueDate: string; status: "active" | "paused" };
type ObservedSubscription = { subscriptionReference: string; provider: string; merchantName: string; expectedAmount?: string; currency?: string; cadence?: string; nextExpectedAt?: string; status: string };
type Response = { reminders: Reminder[]; observedSubscriptions: ObservedSubscription[] };
const minimumDueDate = new Date().toISOString().slice(0, 10);

export function BillsWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");

  async function authorized(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: "no-store" });
    const body = await response.json() as { message?: string };
    if (!response.ok) throw new Error(body.message ?? "That request could not be completed.");
    return body;
  }
  const query = useQuery<Response>({ queryKey: ["bills", user?.id], queryFn: () => authorized("/api/bills") as Promise<Response>, enabled: Boolean(user) });
  const update = useMutation({ mutationFn: ({ billId, action }: { billId: string; action: "pause" | "resume" }) => authorized("/api/bills", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ billId, action }) }), onSuccess: () => client.invalidateQueries({ queryKey: ["bills"] }) });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); const form = new FormData(event.currentTarget);
    try {
      await authorized("/api/bills", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: form.get("name"), category: form.get("category"), expectedAmount: form.get("expectedAmount") || undefined, currency: form.get("currency"), frequency: form.get("frequency"), nextDueDate: form.get("nextDueDate") }) });
      setOpen(false); event.currentTarget.reset(); await client.invalidateQueries({ queryKey: ["bills"] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Reminder could not be saved."); }
  }

  const empty = !query.data?.reminders.length && !query.data?.observedSubscriptions.length;
  return <>
    <section className="panel billsWorkspace">
      <div className="panelHeading"><div><h2>Bills & Subscriptions</h2></div><button className="button quiet small" onClick={() => setOpen(true)}><Plus size={14} /> Add Reminder</button></div>
      {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Loading bills</div> : query.isError ? <div className="formError">Bills could not be loaded.</div> : empty ? <div className="emptyState compact"><ReceiptText size={22} /><strong>No upcoming bills</strong><span>Add a reminder now. Provider-observed subscriptions will appear automatically after bank or card setup.</span></div> : <div className="billRows">
        {query.data.observedSubscriptions.map((item) => <div key={item.subscriptionReference}><span className="billIcon"><CreditCard size={16} /></span><span><strong>{item.merchantName}</strong><small>{item.cadence ?? "Recurring"}{item.nextExpectedAt ? ` · ${new Date(item.nextExpectedAt).toLocaleDateString()}` : ""}</small></span><b>{item.expectedAmount ? `${item.expectedAmount} ${item.currency ?? ""}` : "Observed"}</b><em>{item.provider}</em></div>)}
        {query.data.reminders.map((item) => <div key={item.billId}><span className="billIcon"><CalendarDays size={16} /></span><span><strong>{item.name}</strong><small>{item.frequency} · {new Date(`${item.nextDueDate}T12:00:00Z`).toLocaleDateString()}</small></span><b>{item.expectedAmount ? `${item.expectedAmount} ${item.currency}` : "Amount open"}</b><button aria-label={item.status === "paused" ? `Resume ${item.name}` : `Pause ${item.name}`} onClick={() => update.mutate({ billId: item.billId, action: item.status === "paused" ? "resume" : "pause" })}>{item.status === "paused" ? <Play size={14} /> : <Pause size={14} />}</button></div>)}
      </div>}
      <p className="authorityFootnote">Reminders never move money. Automatic payments require a provider-backed mandate and a separate confirmation flow.</p>
    </section>
    {open && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="bill-title"><button className="modalClose" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button><h2 id="bill-title">Add Bill Reminder</h2><p>Track the due date without authorizing a payment.</p><form onSubmit={create}><label className="fieldLabel">Name<input name="name" required maxLength={80} placeholder="Electricity" /></label><label className="fieldLabel">Category<select name="category" defaultValue="utilities"><option value="housing">Housing</option><option value="utilities">Utilities</option><option value="communications">Communications</option><option value="insurance">Insurance</option><option value="subscriptions">Subscriptions</option><option value="taxes">Taxes</option><option value="other">Other</option></select></label><div className="formSplit"><label className="fieldLabel">Expected Amount <span className="optionalLabel">Optional</span><input name="expectedAmount" inputMode="decimal" placeholder="120.00" pattern="\d+(\.\d{1,2})?" /></label><label className="fieldLabel">Currency<select name="currency" defaultValue="USD"><option>USD</option><option>EUR</option><option>GBP</option></select></label></div><div className="formSplit"><label className="fieldLabel">Frequency<select name="frequency" defaultValue="monthly"><option value="monthly">Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></label><label className="fieldLabel">Next Due<input name="nextDueDate" type="date" required min={minimumDueDate} /></label></div>{error && <div className="formError">{error}</div>}<button className="button primary full" type="submit">Save Reminder</button></form></section></div>}
  </>;
}

