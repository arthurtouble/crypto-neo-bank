"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useToast } from "./toast";

type Tag = { tag: string; address: string; displayName: string; publicEnabled: boolean; publicBankEnabled: boolean };

export function AuraTagControls() {
  const { user, getAccessToken } = usePrivy();
  const { address } = useAuraWallet();
  const [current, setCurrent] = useState<Tag | null>(null);
  const [tag, setTag] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [enabled, setEnabled] = useState(false);
  const [bankEnabled, setBankEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const toast = useToast();
  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    void (async () => {
      try {
        const token = await getAccessToken();
        if (!token) return;
        const response = await fetch("/api/aura-tags", { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) throw new Error("Aura tag settings are unavailable.");
        const body = await response.json() as { tag: Tag | null };
        if (cancelled) return;
        setCurrent(body.tag); setTag(body.tag?.tag ?? ""); setDisplayName(body.tag?.displayName ?? ""); setEnabled(body.tag?.publicEnabled ?? false); setBankEnabled(body.tag?.publicBankEnabled ?? false);
      } catch (error) { if (!cancelled) setMessage(error instanceof Error ? error.message : "Aura tag settings are unavailable."); }
    })();
    return () => { cancelled = true; };
  }, [user, getAccessToken]);
  async function save(event: React.FormEvent) {
    event.preventDefault(); setBusy(true);
    try {
      if (!address) throw new Error("Your wallet isn't ready yet.");
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to save your tag.");
      const response = await fetch("/api/aura-tags", { method: "PUT", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ tag, address, displayName, publicEnabled: enabled, publicBankEnabled: enabled && bankEnabled }) });
      if (!response.ok) {
        const result = await response.json() as { error?: string };
        throw new Error(result.error === "tag_taken" ? "That tag is already taken." : "Your tag could not be saved.");
      }
      const result = await response.json() as Tag;
      setCurrent(result); setTag(result.tag); toast.success("Aura tag saved");
    } catch (error) { toast.error("Tag not saved", error instanceof Error ? error.message : undefined); }
    finally { setBusy(false); }
  }
  return <section className="panel settingsPanel" id="tag"><h2>Aura tag</h2><p>Choose a public name for receiving crypto. You control whether its payment page is visible.</p>
    <form onSubmit={(event) => void save(event)} className="auraTagForm">
      <label className="fieldLabel">Tag<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="yourname" required minLength={3} maxLength={25} /></label>
      <label className="fieldLabel">Public display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={48} /></label>
      <label className="supportUrgent"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Show my payment page publicly</label>
      <label className="supportUrgent"><input type="checkbox" checked={bankEnabled} disabled={!enabled} onChange={(event) => setBankEnabled(event.target.checked)} /> Show my Bridge bank details on the public page when available</label>
      <button className="button primary" disabled={busy || !address}>{busy ? "Saving…" : "Save Aura tag"}</button>
    </form>
    {current?.publicEnabled && <Link className="textLink" href={`/pay/${current.tag}`}>View your payment page</Link>}
    {message && <p role="status">{message}</p>}
  </section>;
}
