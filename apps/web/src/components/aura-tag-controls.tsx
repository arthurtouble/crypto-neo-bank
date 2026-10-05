"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { withPasskey } from "@/lib/client/with-passkey";
import { useState } from "react";
import Link from "next/link";
import { SettingRow, useSettingsToast } from "./setting-row";
import { LoadingState, Notice } from "./states";

type Tag = { tag: string; address: string; displayName: string; publicEnabled: boolean; publicBankEnabled: boolean };

/**
 * The Aura tag and its payment page. The form shows only once the saved tag has loaded, so a failed read can't
 * leave an empty form that would replace the tag on save.
 */
export function AuraTagControls() {
  const { user } = useAuth();
  const api = useApi();
  const saved = useQuery({ queryKey: ["aura-tag", user?.id], enabled: Boolean(user), queryFn: () => api<{ tag: Tag | null }>("/api/aura-tags") });
  if (saved.isPending) return <section className="mxCard stCard"><LoadingState label="Loading your Aura tag…" /></section>;
  if (saved.isError) return <section className="mxCard stCard" aria-labelledby="tag-heading"><h2 id="tag-heading">Aura tag and payment page</h2>
    <Notice tone="error" role="alert" onRetry={() => void saved.refetch()}>Your Aura tag can&apos;t be loaded right now.</Notice></section>;
  return <AuraTagForm key={saved.data.tag?.tag ?? ""} current={saved.data.tag} />;
}

function AuraTagForm({ current }: { current: Tag | null }) {
  const { user } = useAuth();
  const { address, authorize } = useAuraWallet();
  const api = useApi();
  const client = useQueryClient();
  const toast = useSettingsToast();
  const [tag, setTag] = useState(current?.tag ?? "");
  const [displayName, setDisplayName] = useState(current?.displayName ?? "");
  const [enabled, setEnabled] = useState(current?.publicEnabled ?? false);
  const [bankEnabled, setBankEnabled] = useState(current?.publicBankEnabled ?? false);
  const [busy, setBusy] = useState(false);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      if (!address) throw new Error("Your account isn't ready yet. Try again in a moment.");
      const json = { tag, address, displayName, publicEnabled: enabled, publicBankEnabled: enabled && bankEnabled };
      // Changing where the tag's payments go asks for the customer's passkey first.
      const result = await withPasskey((confirmation) => api<Tag>("/api/aura-tags", { method: "PUT", json: { ...json, confirmation } }), authorize);
      client.setQueryData(["aura-tag", user?.id], { tag: result });
      toast.success("Aura tag saved");
    } catch (error) {
      const message = !(error instanceof ApiError) ? error instanceof Error ? error.message : undefined
        : error.code === "tag_taken" ? "That tag is already taken."
          : error.body.message ? error.message : "Your tag could not be saved.";
      toast.error("Tag not saved", message);
    }
    finally { setBusy(false); }
  }
  return <section className="mxCard stCard" id="tag" aria-labelledby="tag-heading"><h2 id="tag-heading">Aura tag and payment page</h2>
    <p className="mxHint">Choose a public name for receiving crypto. You control whether its payment page is visible.</p>
    <form onSubmit={(event) => void save(event)} className="mxForm">
      <div className="mxFieldRow">
        <label className="mxField">Tag<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="yourname" autoComplete="off" autoCapitalize="none" spellCheck={false} required minLength={3} maxLength={25} /></label>
        <label className="mxField">Public display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={48} /></label>
      </div>
      <div>
        <SettingRow label title="Show my payment page publicly" detail="Anyone with the link can see your tag, display name, and how to pay you.">
          <input type="checkbox" className="appSwitch" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /></SettingRow>
        <SettingRow label title="Show my bank details on the page" detail="Only once your bank account in Aura is active.">
          <input type="checkbox" className="appSwitch" checked={enabled && bankEnabled} disabled={!enabled} onChange={(event) => setBankEnabled(event.target.checked)} /></SettingRow>
      </div>
      <div className="mxActions">
        <button type="submit" className="appButton appButtonPrimary" disabled={busy || !address}>{busy ? "Saving…" : "Save Aura tag"}</button>
        {current?.publicEnabled && <Link className="appButton" href={`/pay/${current.tag}`}>View your payment page</Link>}
      </div>
    </form>
  </section>;
}
