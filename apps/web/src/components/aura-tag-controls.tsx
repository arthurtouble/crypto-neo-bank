"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { useEffect, useRef, useState } from "react";
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
  return <section className="mxCard stCard" id="tag" aria-labelledby="tag-heading"><h2 id="tag-heading">Aura tag and payment page</h2>
    <p className="mxHint">Choose a public name for receiving crypto. You control whether its payment page is visible.</p>
    <form onSubmit={(event) => void save(event)} className="mxForm">
      <div className="mxFieldRow">
        <label className="mxField">Tag<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="yourname" required minLength={3} maxLength={25} /></label>
        <label className="mxField">Public display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required maxLength={48} /></label>
      </div>
      <label className="mxCheck"><input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} /> Show my payment page publicly</label>
      <label className="mxCheck"><input type="checkbox" checked={bankEnabled} disabled={!enabled} onChange={(event) => setBankEnabled(event.target.checked)} /> Show my Bridge bank details on the public page when available</label>
      <div className="mxActions">
        <button className="appButton appButtonPrimary" disabled={busy || !address}>{busy ? "Saving…" : "Save Aura tag"}</button>
        {current?.publicEnabled && <Link className="appButton" href={`/pay/${current.tag}`}>View your payment page</Link>}
      </div>
    </form>
    {message && <p className="mxNote mxNoteWarning" role="status">{message}</p>}
  </section>;
}
