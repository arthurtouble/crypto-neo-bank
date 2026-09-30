"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { formatDateTime, shortAddress } from "@/lib/format";
import { SettingRow } from "./setting-row";
import { useToast } from "./toast";
import { LoadingState, Notice } from "./states";
import { StatusDot } from "./status-dot";

type Policy = { accountLocked: boolean; enforceAddressBook: boolean; dailyLimitUsd: number | null; newAddressDelayHours: number;
  policyVersion: number; updatedAt: string; enforcement: "aura" };
type PolicyChange = Partial<Pick<Policy, "accountLocked" | "enforceAddressBook" | "dailyLimitUsd" | "newAddressDelayHours">>;
type Entry = { entryId: string; address: string; label: string; createdAt: string; availableAt: string; lastUsedAt?: string };


/** A whole number within bounds, or undefined when the draft isn't one. */
function wholeNumber(draft: string, min: number, max: number) {
  const value = Number(draft);
  return /^\d+$/.test(draft) && value >= min && value <= max ? value : undefined;
}

function usePolicy() {
  const { user } = usePrivy();
  const api = useApi();
  return useQuery({ queryKey: ["security-policy", user?.id], enabled: Boolean(user), queryFn: () => api<{ policy: Policy }>("/api/security/policy") });
}

const Loading = ({ label }: { label: string }) => <section className="mxCard stCard"><LoadingState label={label} /></section>;

/** The emergency lock, daily limit, and saved-recipients-only. Tightening applies at once; loosening needs the passkey. */
export function TransactionControls() {
  const { user } = usePrivy();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [dailyDraft, setDailyDraft] = useState<string | null>(null);
  const [delayDraft, setDelayDraft] = useState<string | null>(null);
  const policy = usePolicy();
  const { authorize, enrollPasskey } = useAuraWallet();
  const update = useMutation({
    // Tightening applies at once. Loosening asks for a passkey confirmation of that exact change, then sends it again with the signature.
    mutationFn: async (changes: PolicyChange) => {
      try { return await api<{ policy: Policy }>("/api/security/policy", { method: "PATCH", json: changes }); }
      catch (error) {
        if (!(error instanceof ApiError) || error.code !== "confirmation_required") throw error;
        const { challengeId, request } = error.body as { challengeId: string; request: AuthorizationRequest<unknown> };
        const signature = await authorize(request);
        return api<{ policy: Policy }>("/api/security/policy", { method: "PATCH", json: { ...changes, confirmation: { challengeId, signature } } });
      }
    },
    onSuccess: () => toast.success("Controls updated"),
    onError: (error) => {
      if (error instanceof ApiError && error.code === "mfa_required") { toast.error("Add a passkey first", "Loosening a control needs your passkey."); enrollPasskey(); return; }
      toast.error("Controls not changed", error instanceof ApiError ? error.message : "You cancelled the passkey check, so nothing changed.");
    },
    onSettled: async () => { setDailyDraft(null); setDelayDraft(null); await queryClient.invalidateQueries({ queryKey: ["security-policy", user?.id] }); }
  });

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

  if (policy.isPending) return <Loading label="Loading transaction controls…" />;
  if (policy.isError || !policy.data) return <section className="mxCard stCard"><Notice tone="error" role="alert">We couldn&apos;t load your controls. Your limits still apply.</Notice></section>;
  const current = policy.data.policy;
  return <section className="mxCard stCard" id="emergency-lock" aria-labelledby="controls-heading">
    <div className="stCardHead"><h2 id="controls-heading">Transaction controls</h2>
      <StatusDot tone={current.accountLocked ? "warning" : "positive"} label={current.accountLocked ? "Locked" : "Active"} /></div>
    <SettingRow label title="Emergency lock" detail="Stop all sends, swaps, and Earn moves. Unlocking needs your passkey.">
      <input type="checkbox" className="appSwitch" checked={current.accountLocked} disabled={update.isPending} onChange={(event) => update.mutate({ accountLocked: event.target.checked })} /></SettingRow>
    <SettingRow label title="Daily transfer limit" detail="In USD. Leave empty for no limit.">
      <input type="number" inputMode="numeric" autoComplete="off" className="stNumber" min="1" step="1" placeholder="No limit" disabled={update.isPending} value={dailyDraft ?? (current.dailyLimitUsd === null ? "" : String(current.dailyLimitUsd))}
        onChange={(event) => setDailyDraft(event.target.value)} onBlur={() => saveDailyLimit(current.dailyLimitUsd)} /></SettingRow>
    <SettingRow label title="Saved recipients only" detail="Only send to saved recipients, after their wait.">
      <input type="checkbox" className="appSwitch" checked={current.enforceAddressBook} disabled={update.isPending} onChange={(event) => update.mutate({ enforceAddressBook: event.target.checked })} /></SettingRow>
    {current.enforceAddressBook && <SettingRow label title="Wait before new recipients" detail="Hours before a new saved recipient can receive.">
      <input type="number" inputMode="numeric" autoComplete="off" className="stNumber" min="0" max="168" step="1" disabled={update.isPending} value={delayDraft ?? String(current.newAddressDelayHours)}
        onChange={(event) => setDelayDraft(event.target.value)} onBlur={() => saveDelay(current.newAddressDelayHours)} /></SettingRow>}
    <p className="mxHint">Making a control stricter applies right away. Loosening one needs your passkey.</p>
  </section>;
}

/** Saved recipients: the same list Send picks from. Each new one sends a security notice. */
export function SavedRecipients() {
  const { user } = usePrivy();
  const api = useApi();
  const queryClient = useQueryClient();
  const toast = useToast();
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState("");
  const policy = usePolicy();
  const addresses = useQuery({ queryKey: ["address-book", user?.id], enabled: Boolean(user),
    queryFn: () => api<{ entries: Entry[] }>("/api/security/addresses") });

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

  if (addresses.isPending || policy.isPending) return <Loading label="Loading saved recipients…" />;
  if (addresses.isError || policy.isError) return <section className="mxCard stCard"><Notice tone="error" role="alert">We couldn&apos;t load your saved recipients. Try again.</Notice></section>;
  const current = policy.data?.policy;
  return <section className="mxCard stCard" id="recipients" aria-labelledby="recipients-heading"><h2 id="recipients-heading">Saved recipients</h2>
    <p className="mxHint">{!current?.enforceAddressBook || current.newAddressDelayHours === 0 ? "Pick them by name when you send." : `New recipients are ready after ${current.newAddressDelayHours} hours.`}</p>
    {addresses.data.entries.length ? <ul className="stList" aria-label="Saved recipients">{addresses.data.entries.map((entry) => {
      const cooling = new Date(entry.availableAt) > new Date();
      return <li key={entry.entryId} className="stListRow">
        <span className="appIconDisc stFace" aria-hidden="true">{entry.label.slice(0, 1).toUpperCase()}</span>
        <span className="stRowText"><strong>{entry.label}</strong><small>{shortAddress(entry.address)}{cooling ? ` · available ${formatDateTime(entry.availableAt)}` : ""}</small></span>
        <StatusDot tone={cooling ? "warning" : "positive"} label={cooling ? "Waiting" : "Ready"} />
        <button type="button" className="appIconButton" aria-label={`Remove ${entry.label}`} onClick={() => void removeAddress(entry.entryId)}><Trash2 aria-hidden="true" /></button>
      </li>; })}</ul> : <p className="stEmpty">No saved recipients yet.</p>}
    <form onSubmit={(event) => void addAddress(event)} className="mxForm stAddForm" aria-label="Add a recipient">
      <div className="mxFieldRow">
        <label className="mxField">Label<input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="Treasury wallet" /></label>
        <label className="mxField">EVM address<input className="mxMonoInput" value={address} onChange={(event) => setAddress(event.target.value.trim())} placeholder="0x…" autoComplete="off" autoCapitalize="none" spellCheck={false} /></label>
      </div>
      <button type="submit" className="appButton mxStart" disabled={!address || !label}><Plus aria-hidden="true" /> Save</button>
    </form>
  </section>;
}
