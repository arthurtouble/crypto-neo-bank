"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertOctagon, Check, Clock3, LoaderCircle, LockKeyhole, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

type Policy = { accountLocked: boolean; enforceAddressBook: boolean; dailyLimitUsd: number; newAddressThresholdUsd: number; newAddressDelayHours: number; stepUpThresholdUsd: number; updatedAt: string };
type Entry = { entryId: string; address: string; label: string; createdAt: string; availableAt: string; lastUsedAt?: string };

function short(value: string) { return `${value.slice(0, 7)}…${value.slice(-5)}`; }

export function SecurityPolicyControls() {
  const { user, getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  async function authenticatedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    return fetch(url, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.headers ?? {}) } });
  }

  const policy = useQuery<{ policy: Policy }>({ queryKey: ["security-policy", user?.id], queryFn: async () => { const response = await authenticatedFetch("/api/security/policy", { cache: "no-store" }); if (!response.ok) throw new Error("Security controls are unavailable."); return response.json(); }, enabled: Boolean(user) });
  const addresses = useQuery<{ entries: Entry[] }>({ queryKey: ["address-book", user?.id], queryFn: async () => { const response = await authenticatedFetch("/api/security/addresses", { cache: "no-store" }); if (!response.ok) throw new Error("Address book is unavailable."); return response.json(); }, enabled: Boolean(user) });
  const update = useMutation({ mutationFn: async (changes: Partial<Policy>) => { const response = await authenticatedFetch("/api/security/policy", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(changes) }); const body = await response.json() as { policy?: Policy; error?: string }; if (!response.ok) throw new Error(body.error ?? "The policy could not be updated."); return body; }, onMutate: () => setMessage(null), onSuccess: async () => { setMessage("Security policy updated."); await queryClient.invalidateQueries({ queryKey: ["security-policy", user?.id] }); }, onError: (error) => { setMessage(error.message === "step_up_unavailable" ? "To loosen a control, contact Support for identity verification." : error.message === "security_policy_changed" ? "These controls changed in another session. Refresh and try again." : "The policy could not be updated."); } });

  async function addAddress(event: React.FormEvent) {
    event.preventDefault(); setMessage(null);
    const response = await authenticatedFetch("/api/security/addresses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ address, label }) });
    const body = await response.json() as { error?: string };
    if (!response.ok) { setMessage(body.error === "invalid_address_entry" ? "Enter a valid EVM address and label." : "The destination could not be saved."); return; }
    setAddress(""); setLabel(""); setMessage("Destination saved. Its cooling period has started.");
    await queryClient.invalidateQueries({ queryKey: ["address-book", user?.id] });
  }

  async function removeAddress(entryId: string) {
    const response = await authenticatedFetch(`/api/security/addresses?entryId=${encodeURIComponent(entryId)}`, { method: "DELETE" });
    if (!response.ok) { setMessage("The destination could not be removed."); return; }
    setMessage("Destination removed.");
    await queryClient.invalidateQueries({ queryKey: ["address-book", user?.id] });
  }

  if (policy.isPending || addresses.isPending) return <section className="panel securityPolicyPanel emptyState"><LoaderCircle className="spin" size={18} /> Loading transaction controls…</section>;
  if (policy.isError || addresses.isError || !policy.data) return <section className="panel securityPolicyPanel formError">Security controls could not be loaded. Outgoing activity remains subject to server policy.</section>;
  const current = policy.data.policy;
  return <>
    <section className="panel securityPolicyPanel"><div className="panelHeading"><div><h2>Transaction Controls</h2></div><span className={`statusBadge ${current.accountLocked ? "warning" : "good"}`}><i /> {current.accountLocked ? "Locked" : "Active"}</span></div>
      <div className="policyControlRows">
        <label><span><LockKeyhole size={17} /><b>Emergency Lock<small>Block new outgoing transfers.</small></b></span><input type="checkbox" checked={current.accountLocked} disabled={update.isPending || current.accountLocked} onChange={(event) => update.mutate({ accountLocked: event.target.checked })} /></label>
        <label><span><Check size={17} /><b>Saved Destinations Only<small>Only send to approved recipients.</small></b></span><input type="checkbox" checked={current.enforceAddressBook} disabled={update.isPending || current.enforceAddressBook} onChange={(event) => update.mutate({ enforceAddressBook: event.target.checked })} /></label>
        <label><span><AlertOctagon size={17} /><b>Daily Transfer Limit</b></span><input type="number" key={`daily-${current.updatedAt}`} min="100" step="100" defaultValue={current.dailyLimitUsd} onBlur={(event) => { const value = Number(event.target.value); if (value !== current.dailyLimitUsd) update.mutate({ dailyLimitUsd: value }); }} /><em>USD</em></label>
        <label><span><Clock3 size={17} /><b>New Recipient Limit</b></span><input type="number" key={`recipient-${current.updatedAt}`} min="0" step="100" defaultValue={current.newAddressThresholdUsd} onBlur={(event) => { const value = Number(event.target.value); if (value !== current.newAddressThresholdUsd) update.mutate({ newAddressThresholdUsd: value }); }} /><em>USD</em></label>
      </div>
      <p className="sourceCaption">To unlock or raise a limit, <Link href="/app/concierge">contact Support</Link>.</p>
      {message && <div className="securityMessage" role="status">{message}</div>}
    </section>
    <section className="panel addressBookPanel"><div className="panelHeading"><div><h2>Saved Destinations</h2><p className="sourceCaption">New destinations are ready after {current.newAddressDelayHours} hours.</p></div></div>
      <form onSubmit={(event) => void addAddress(event)} className="addressForm"><label className="fieldLabel">Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Treasury wallet" /></label><label className="fieldLabel">EVM address<input value={address} onChange={(event) => setAddress(event.target.value.trim())} placeholder="0x…" spellCheck={false} /></label><button className="button secondary" disabled={!address || !label}><Plus size={14} /> Save</button></form>
      <div className="addressList">{addresses.data?.entries.length ? addresses.data.entries.map((entry) => { const cooling = new Date(entry.availableAt) > new Date(); return <div key={entry.entryId}><span className={cooling ? "pending" : "ready"}>{cooling ? <Clock3 size={13} /> : <Check size={13} />}{cooling ? "Cooling" : "Ready"}</span><div><strong>{entry.label}</strong><small>{short(entry.address)} · {cooling ? `available ${new Date(entry.availableAt).toLocaleString()}` : "approved destination"}</small></div><button aria-label={`Remove ${entry.label}`} onClick={() => void removeAddress(entry.entryId)}><Trash2 size={14} /></button></div>; }) : <div className="emptyAddress">No saved destinations yet.</div>}</div>
    </section>
  </>;
}
