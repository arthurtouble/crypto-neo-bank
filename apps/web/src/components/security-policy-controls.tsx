"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, Check, Clock3, LoaderCircle, LockKeyhole, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { ApiError, useApi } from "@/lib/client/api";
import { useToast } from "./toast";

type Policy = { accountLocked: boolean; enforceAddressBook: boolean; dailyLimitUsd: number | null; newAddressDelayHours: number;
  policyVersion: number; updatedAt: string; enforcement: "aura" };
type PolicyChange = Partial<Pick<Policy, "accountLocked" | "enforceAddressBook" | "dailyLimitUsd" | "newAddressDelayHours">>;
type WalletPolicy = { policyId: string; policyType: string; enabled: boolean; updatedAt: string };
type Entry = { entryId: string; address: string; label: string; createdAt: string; availableAt: string; lastUsedAt?: string };

function short(value: string) { return `${value.slice(0, 7)}…${value.slice(-5)}`; }

/** A whole number within bounds, or undefined when the draft isn't one. */
function wholeNumber(draft: string, min: number, max: number) {
  const value = Number(draft);
  return /^\d+$/.test(draft) && value >= min && value <= max ? value : undefined;
}

export function SecurityPolicyControls() {
  const { user } = usePrivy();
  const api = useApi();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const toast = useToast();
  const [dailyDraft, setDailyDraft] = useState<string | null>(null);
  const [delayDraft, setDelayDraft] = useState<string | null>(null);

  const policy = useQuery({ queryKey: ["security-policy", user?.id], enabled: Boolean(user),
    queryFn: () => api<{ policy: Policy; walletPolicies?: WalletPolicy[] }>("/api/security/policy") });
  const addresses = useQuery({ queryKey: ["address-book", user?.id], enabled: Boolean(user),
    queryFn: () => api<{ entries: Entry[] }>("/api/security/addresses") });
  const update = useMutation({
    mutationFn: (changes: PolicyChange) => api<{ policy: Policy }>("/api/security/policy", { method: "PATCH", json: changes }),
    onSuccess: () => toast.success("Controls updated"),
    onError: (error) => toast.error("Controls not updated", error instanceof ApiError && error.code === "security_policy_changed" ? error.message : "Try again."),
    onSettled: async () => { setDailyDraft(null); setDelayDraft(null); await queryClient.invalidateQueries({ queryKey: ["security-policy", user?.id] }); }
  });

  async function addAddress(event: React.FormEvent) {
    event.preventDefault();
    try { await api("/api/security/addresses", { method: "POST", json: { address, label } }); }
    catch (error) { toast.error("Recipient not saved", error instanceof ApiError && error.code === "invalid_address_entry" ? "Enter a valid wallet address and label." : "Try again."); return; }
    setAddress(""); setLabel(""); toast.success("Recipient saved");
    await queryClient.invalidateQueries({ queryKey: ["address-book", user?.id] });
  }

  async function removeAddress(entryId: string) {
    try { await api(`/api/security/addresses?entryId=${encodeURIComponent(entryId)}`, { method: "DELETE" }); }
    catch { toast.error("Recipient not removed", "Try again."); return; }
    toast.success("Recipient removed");
    await queryClient.invalidateQueries({ queryKey: ["address-book", user?.id] });
  }

  function saveDailyLimit(current: number | null) {
    if (dailyDraft === null) return;
    const next = dailyDraft.trim() === "" ? null : wholeNumber(dailyDraft.trim(), 1, 10_000_000);
    if (next === undefined) { setDailyDraft(null); toast.error("Limit not changed", "Enter a whole dollar amount, or leave it empty for no limit."); return; }
    if (next !== current) update.mutate({ dailyLimitUsd: next }); else setDailyDraft(null);
  }

  function saveDelay(current: number) {
    if (delayDraft === null) return;
    const next = wholeNumber(delayDraft.trim(), 0, 168);
    if (next === undefined) { setDelayDraft(null); toast.error("Delay not changed", "Enter between 0 and 168 hours."); return; }
    if (next !== current) update.mutate({ newAddressDelayHours: next }); else setDelayDraft(null);
  }

  if (policy.isPending || addresses.isPending) return <section className="panel securityPolicyPanel emptyState"><LoaderCircle className="spin" size={18} /> Loading transaction controls…</section>;
  if (policy.isError || addresses.isError || !policy.data) return <section className="panel securityPolicyPanel formError">We couldn’t load your controls. Your limits still apply.</section>;
  const current = policy.data.policy;
  return <>
    <section className="panel securityPolicyPanel"><div className="panelHeading"><div><h2>Transaction controls</h2></div><span className={`statusBadge ${current.accountLocked ? "warning" : "good"}`}><i /> {current.accountLocked ? "Locked" : "Active"}</span></div>
      <div className="policyControlRows">
        <label><span><LockKeyhole size={17} /><b>Emergency lock<small>Block new outgoing transfers.</small></b></span><input type="checkbox" checked={current.accountLocked} disabled={update.isPending} onChange={(event) => update.mutate({ accountLocked: event.target.checked })} /></label>
        <label><span><Check size={17} /><b>Saved recipients only<small>Only send to saved recipients.</small></b></span><input type="checkbox" checked={current.enforceAddressBook} disabled={update.isPending} onChange={(event) => update.mutate({ enforceAddressBook: event.target.checked })} /></label>
        <label><span><AlertOctagon size={17} /><b>Daily transfer limit<small>Leave empty for no limit.</small></b></span><input type="number" min="1" step="1" placeholder="No limit" disabled={update.isPending} value={dailyDraft ?? (current.dailyLimitUsd === null ? "" : String(current.dailyLimitUsd))} onChange={(event) => setDailyDraft(event.target.value)} onBlur={() => saveDailyLimit(current.dailyLimitUsd)} /><em>USD</em></label>
        <label><span><Clock3 size={17} /><b>Wait before new recipients<small>Hours before a new saved recipient can receive.</small></b></span><input type="number" min="0" max="168" step="1" disabled={update.isPending} value={delayDraft ?? String(current.newAddressDelayHours)} onChange={(event) => setDelayDraft(event.target.value)} onBlur={() => saveDelay(current.newAddressDelayHours)} /><em>Hours</em></label>
      </div>
      <p className="sourceCaption">Changes apply right away. These controls apply to transfers Aura prepares.</p>
    </section>
    <section className="panel addressBookPanel"><div className="panelHeading"><div><h2>Saved recipients</h2><p className="sourceCaption">{current.newAddressDelayHours === 0 ? "New recipients are ready right away." : `New recipients are ready after ${current.newAddressDelayHours} hours.`}</p></div></div>
      <form onSubmit={(event) => void addAddress(event)} className="addressForm"><label className="fieldLabel">Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Treasury wallet" /></label><label className="fieldLabel">EVM address<input value={address} onChange={(event) => setAddress(event.target.value.trim())} placeholder="0x…" spellCheck={false} /></label><button className="button secondary" disabled={!address || !label}><Plus size={14} /> Save</button></form>
      <div className="addressList">{addresses.data?.entries.length ? addresses.data.entries.map((entry) => { const cooling = new Date(entry.availableAt) > new Date(); return <div key={entry.entryId}><span className={cooling ? "pending" : "ready"}>{cooling ? <Clock3 size={13} /> : <Check size={13} />}{cooling ? "Waiting" : "Ready"}</span><div><strong>{entry.label}</strong><small>{short(entry.address)} · {cooling ? `available ${new Date(entry.availableAt).toLocaleString()}` : "ready"}</small></div><button aria-label={`Remove ${entry.label}`} onClick={() => void removeAddress(entry.entryId)}><Trash2 size={14} /></button></div>; }) : <div className="emptyAddress">No saved recipients yet.</div>}</div>
    </section>
    {policy.data.walletPolicies?.length ? <section className="panel securityPolicyPanel"><div className="panelHeading"><div><h2>Wallet provider rules</h2>
      <p className="sourceCaption">Enforced by your wallet provider when it signs. Aura shows them here; change them with the provider.</p></div></div>
      <div className="addressList">{policy.data.walletPolicies.map((rule) => <div key={rule.policyId}><span className={rule.enabled ? "ready" : "pending"}>{rule.enabled ? <Check size={13} /> : <Clock3 size={13} />}</span>
        <strong>{rule.policyType.replaceAll("_", " ")}</strong><small>{rule.enabled ? "On" : "Off"} · updated {new Date(rule.updatedAt).toLocaleString()}</small></div>)}</div>
    </section> : null}
  </>;
}
