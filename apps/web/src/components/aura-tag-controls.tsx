"use client";

import { ApiError, useApi } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { withPasskey } from "@/lib/client/with-passkey";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useToast } from "./toast";
import { Notice } from "./states";

type Tag = { tag: string; address: string; displayName: string; publicEnabled: boolean; publicBankEnabled: boolean };

export function AuraTagControls() {
  const { user, getAccessToken } = useAuth();
  const { address, authorize } = useAuraWallet();
  const api = useApi();
  const [current, setCurrent] = useState<Tag | null>(null);
  const [tag, setTag] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [bankEnabled, setBankEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toast = useToast();
  const tokenRef = useRef(getAccessToken);
  useEffect(() => { tokenRef.current = getAccessToken; }, [getAccessToken]);
  // Load the saved tag once per customer; reloading on every render would wipe what they're typing.
  const userId = user?.id;
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await tokenRef.current();
        if (!token) return;
        const response = await fetch("/api/aura-tags", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) throw new Error("Aura tag settings are unavailable.");
        const body = await response.json() as { tag: Tag | null };
        if (cancelled) return;
        setCurrent(body.tag); setTag(body.tag?.tag ?? ""); setDisplayName(body.tag?.displayName ?? ""); setEnabled(body.tag?.publicEnabled ?? false); setBankEnabled(body.tag?.publicBankEnabled ?? false);
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Aura tag settings are unavailable."); }
    })();
    return () => { cancelled = true; };
  }, [userId]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      if (!address) throw new Error("Your wallet isn't ready yet.");
      const json = { tag, address, displayName, publicEnabled: enabled, publicBankEnabled: enabled && bankEnabled };
      // Changing where the tag's payments go asks for the customer's passkey first.
      const result = await withPasskey((confirmation) => api<Tag>("/api/aura-tags", { method: "PUT", json: { ...json, confirmation } }), authorize);
      setCurrent(result); setTag(result.tag); toast.success("Aura tag saved");
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
      <label className="mxCheck"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Show my payment page publicly</label>
      <label className="mxCheck"><input type="checkbox" checked={bankEnabled} disabled={!enabled} onChange={(event) => setBankEnabled(event.target.checked)} /> Show my Bridge bank details on the public page when available</label>
      <div className="mxActions">
        <button type="submit" className="appButton appButtonPrimary" disabled={busy || !address}>{busy ? "Saving…" : "Save Aura tag"}</button>
        {current?.publicEnabled && <Link className="appButton" href={`/pay/${current.tag}`}>View your payment page</Link>}
      </div>
    </form>
    {message && <Notice tone="warning" role="status">{message}</Notice>}
  </section>;
}
