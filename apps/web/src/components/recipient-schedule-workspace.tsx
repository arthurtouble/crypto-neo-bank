"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarClock, Check, Clock3, LoaderCircle, Pause, Play, Plus, ShieldCheck, UserRound, X } from "lucide-react";
import { useMemo, useState } from "react";

type Recipient = { id: string; kind: "wallet" | "bank"; name: string; destination: string; detail: string; verified: boolean; recent?: boolean; availableAt?: string; lastUsedAt?: string | null };
type Schedule = { scheduleId: string; scheduleType: "one_time" | "weekly" | "monthly"; destinationKind: "wallet" | "bank"; destinationReference: string; destinationLabel: string; asset: string; amount: string; nextRunAt: string; status: "approval_required" | "provider_managed" | "paused"; provider?: string | null };
type Modal = "recipient" | "schedule" | null;

function scheduleLabel(value: Schedule["scheduleType"]) {
  return value === "one_time" ? "One time" : value === "weekly" ? "Weekly" : "Monthly";
}

export function RecipientScheduleWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [modal, setModal] = useState<Modal>(null);
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [recipientId, setRecipientId] = useState("");
  const [amount, setAmount] = useState("");
  const [asset, setAsset] = useState("USDC");
  const [scheduleType, setScheduleType] = useState<Schedule["scheduleType"]>("one_time");
  const [nextRunAt, setNextRunAt] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function authorizedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    const response = await fetch(url, { ...init, headers: { ...(init?.headers ?? {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, cache: "no-store" });
    const body = await response.json() as Record<string, unknown>;
    if (!response.ok) throw new Error(typeof body.message === "string" ? body.message : "That request could not be completed.");
    return body;
  }

  const recipients = useQuery<{ recipients: Recipient[] }>({ queryKey: ["recipients", user?.id], queryFn: () => authorizedFetch("/api/recipients") as Promise<{ recipients: Recipient[] }>, enabled: Boolean(user) });
  const schedules = useQuery<{ schedules: Schedule[] }>({ queryKey: ["transfer-schedules", user?.id], queryFn: () => authorizedFetch("/api/transfer-schedules") as Promise<{ schedules: Schedule[] }>, enabled: Boolean(user) });
  const availableRecipients = useMemo(() => recipients.data?.recipients.filter((item) => item.kind === "wallet" && item.verified && !item.recent) ?? [], [recipients.data]);

  const addRecipient = useMutation({
    mutationFn: () => authorizedFetch("/api/recipients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "wallet", name, address }) }),
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["recipients"] }); setName(""); setAddress(""); setMessage("Recipient saved. The security cooling period has started."); },
    onError: (error: Error) => setMessage(error.message)
  });
  const addSchedule = useMutation({
    mutationFn: () => {
      const recipient = availableRecipients.find((item) => item.id === recipientId);
      if (!recipient) throw new Error("Choose an available recipient.");
      return authorizedFetch("/api/transfer-schedules", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduleType, destinationKind: "wallet", destinationReference: recipient.destination, destinationLabel: recipient.name, asset, amount, nextRunAt: new Date(nextRunAt).toISOString() }) });
    },
    onSuccess: async () => { await client.invalidateQueries({ queryKey: ["transfer-schedules"] }); setAmount(""); setNextRunAt(""); setMessage("Schedule saved. Each transfer will still require your approval."); },
    onError: (error: Error) => setMessage(error.message)
  });
  const changeSchedule = useMutation({
    mutationFn: ({ scheduleId, action }: { scheduleId: string; action: "pause" | "resume" | "cancel" }) => authorizedFetch("/api/transfer-schedules", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scheduleId, action }) }),
    onSuccess: () => client.invalidateQueries({ queryKey: ["transfer-schedules"] })
  });

  function open(next: Modal) { setMessage(null); setModal(next); if (next === "schedule" && !recipientId) setRecipientId(availableRecipients[0]?.id ?? ""); }

  return <>
    <div className="dailyMoneyGrid">
      <section className="panel dailyMoneyPanel">
        <div className="panelHeading"><div><h2>Recipients</h2></div><button className="button quiet small" onClick={() => open("recipient")}><Plus size={14} /> Add</button></div>
        {recipients.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Loading recipients…</div> : recipients.isError ? <div className="formError">Recipients are unavailable.</div> : recipients.data.recipients.length === 0 ? <div className="emptyState compact"><UserRound size={22} /><strong>No recipients yet</strong><span>Save a wallet address before scheduling transfers.</span></div> : <div className="recipientList">{recipients.data.recipients.slice(0, 5).map((item) => <button key={item.id} onClick={() => { if (item.verified && !item.recent) { setRecipientId(item.id); open("schedule"); } }}><span className="recipientAvatar">{item.name.slice(0, 1).toUpperCase()}</span><span><strong>{item.name}</strong><small>{item.detail}</small></span><em className={item.verified ? "verified" : "cooling"}>{item.verified ? <><ShieldCheck size={12} /> Verified</> : item.recent ? "Recent" : <><Clock3 size={12} /> Cooling</>}</em></button>)}</div>}
      </section>
      <section className="panel dailyMoneyPanel">
        <div className="panelHeading"><div><h2>Scheduled Transfers</h2></div><button className="button quiet small" onClick={() => open("schedule")} disabled={availableRecipients.length === 0}><Plus size={14} /> Schedule</button></div>
        {schedules.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Loading schedules…</div> : schedules.isError ? <div className="formError">Schedules are unavailable.</div> : schedules.data.schedules.length === 0 ? <div className="emptyState compact"><CalendarClock size={22} /><strong>Nothing scheduled</strong><span>Create a plan for a saved recipient. Aurel will ask for approval before money moves.</span></div> : <div className="scheduleList">{schedules.data.schedules.slice(0, 5).map((item) => <div key={item.scheduleId}><span><strong>{item.destinationLabel}</strong><small>{scheduleLabel(item.scheduleType)} · {new Date(item.nextRunAt).toLocaleString()}</small></span><b>{item.amount} {item.asset}</b><button aria-label={item.status === "paused" ? "Resume schedule" : "Pause schedule"} onClick={() => changeSchedule.mutate({ scheduleId: item.scheduleId, action: item.status === "paused" ? "resume" : "pause" })}>{item.status === "paused" ? <Play size={14} /> : <Pause size={14} />}</button></div>)}</div>}
      </section>
    </div>
    <section className="panel billsPanel"><div><CalendarClock size={18} /><span><strong>Bills & Subscriptions</strong><small>Recurring bank payments will appear after bank transfers are connected.</small></span></div><span className="statusBadge neutral">Setup Required</span></section>

    {modal && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setModal(null)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="daily-money-title"><button className="modalClose" onClick={() => setModal(null)} aria-label="Close"><X size={18} /></button>
      {modal === "recipient" ? <form onSubmit={(event) => { event.preventDefault(); setMessage(null); addRecipient.mutate(); }}><h2 id="daily-money-title">Add Recipient</h2><p>Saved wallet addresses follow your security cooling period.</p><label className="fieldLabel">Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder="e.g. Treasury wallet" /></label><label className="fieldLabel">Wallet Address<input value={address} onChange={(event) => setAddress(event.target.value.trim())} placeholder="0x…" autoComplete="off" spellCheck={false} /></label>{message && <div className={addRecipient.isError ? "formError" : "formSuccess"}>{message}</div>}<button className="button primary full" disabled={addRecipient.isPending || !name || !address}>{addRecipient.isPending ? <LoaderCircle className="spin" size={16} /> : <Check size={16} />} Save Recipient</button></form>
      : <form onSubmit={(event) => { event.preventDefault(); setMessage(null); addSchedule.mutate(); }}><h2 id="daily-money-title">Schedule Transfer</h2><p>This creates a plan, not an automatic payment. You approve every transfer.</p><label className="fieldLabel">Recipient<select value={recipientId} onChange={(event) => setRecipientId(event.target.value)}>{availableRecipients.map((item) => <option key={item.id} value={item.id}>{item.name} · {item.detail}</option>)}</select></label><label className="fieldLabel">Frequency<select value={scheduleType} onChange={(event) => setScheduleType(event.target.value as Schedule["scheduleType"])}><option value="one_time">One time</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></label><div className="formSplit"><label className="fieldLabel">Amount<input value={amount} inputMode="decimal" onChange={(event) => setAmount(event.target.value)} placeholder="0.00" /></label><label className="fieldLabel">Asset<select value={asset} onChange={(event) => setAsset(event.target.value)}><option>USDC</option><option>ETH</option><option>WETH</option></select></label></div><label className="fieldLabel">First Transfer<input type="datetime-local" value={nextRunAt} onChange={(event) => setNextRunAt(event.target.value)} /></label>{message && <div className={addSchedule.isError ? "formError" : "formSuccess"}>{message}</div>}<button className="button primary full" disabled={addSchedule.isPending || !recipientId || !amount || !nextRunAt}>{addSchedule.isPending ? <LoaderCircle className="spin" size={16} /> : <CalendarClock size={16} />} Save Schedule</button></form>}
    </section></div>}
  </>;
}
