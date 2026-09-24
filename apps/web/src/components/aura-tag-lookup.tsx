"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function AuraTagLookup() {
  const router = useRouter();
  const [tag, setTag] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function lookup(event: React.FormEvent) {
    event.preventDefault(); setError(""); setBusy(true);
    try {
      const normalized = tag.trim().replace(/^@/, "").toLowerCase();
      const response = await fetch(`/api/aura-tags/${encodeURIComponent(normalized)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("This Aura tag is unavailable.");
      const body = await response.json() as { crypto: { address: string } };
      router.push(`/app/send?sendTo=${encodeURIComponent(body.crypto.address)}&tag=${encodeURIComponent(normalized)}`);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This Aura tag is unavailable."); }
    finally { setBusy(false); }
  }
  return <form className="auraTagLookup" onSubmit={(event) => void lookup(event)}><label className="fieldLabel">Aura tag<input value={tag} onChange={(event) => setTag(event.target.value)} placeholder="@name" required /></label><button className="button secondary" disabled={busy}>{busy ? "Finding…" : "Find recipient"}</button>{error && <p role="alert">{error}</p>}</form>;
}
