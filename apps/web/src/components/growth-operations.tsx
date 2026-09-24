"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { GrowthRegistry } from "./growth-registry";

type WaitlistEntry = { waitlistId: string; email: string; countryHint: string | null; countryHintLabel: string; status: string; createdAt: string };

export function GrowthOperations() {
  const { getAccessToken, user } = usePrivy();
  const [selected, setSelected] = useState<WaitlistEntry | null>(null);
  const [verifiedCountry, setVerifiedCountry] = useState("");
  const [eligibilityEvidence, setEligibilityEvidence] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [working, setWorking] = useState(false);
  const [cursors, setCursors] = useState<string[]>([]);
  const cursor = cursors.at(-1);

  async function authorizedFetch(url: string, init?: RequestInit) {
    const token = await getAccessToken();
    return fetch(url, { ...init, headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) }, cache: "no-store" });
  }

  const waitlist = useQuery<{ entries: WaitlistEntry[]; totalCount: number; nextCursor: string | null }>({
    queryKey: ["growth-waitlist", user?.id, cursor],
    queryFn: async () => {
      const response = await authorizedFetch(`/api/ops/growth/waitlist${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`);
      if (!response.ok) throw new Error("Waitlist is unavailable.");
      return response.json();
    },
    enabled: Boolean(user), retry: false
  });

  async function issueInvite(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || working) return;
    setWorking(true); setError("");
    try {
      const response = await authorizedFetch(`/api/ops/growth/waitlist/${selected.waitlistId}/invite`, {
        method: "POST", body: JSON.stringify({ verifiedCountry: verifiedCountry.toUpperCase(), eligibilityEvidence })
      });
      const body = await response.json() as { code?: string; error?: string };
      if (!response.ok || !body.code) throw new Error(body.error ?? "Invitation could not be issued.");
      setInviteCode(body.code);
      await waitlist.refetch();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invitation could not be issued.");
    } finally {
      setWorking(false);
    }
  }

  return <section className="growthOps">
    <div className="panelHeading"><div><p className="eyebrow">GROWTH OPERATIONS</p><h2>Waitlist</h2><p className="sourceCaption">An IP country hint is approximate. Check eligibility separately before issuing an invitation.</p></div></div>
    <section className="panel growthQueue" aria-label="Waitlist entries">
      {waitlist.isPending ? <p>Loading waitlist…</p> : waitlist.isError ? <p role="alert">Waitlist is unavailable.</p> : waitlist.data?.entries.length ?
        <div className="growthQueueRows">{waitlist.data.entries.map((entry) => <button key={entry.waitlistId} type="button" onClick={() => { setSelected(entry); setInviteCode(""); setError(""); }}>
          <span><strong>{entry.email}</strong><small>{entry.countryHintLabel}: {entry.countryHint ?? "Unknown"}</small></span>
          <span className="statusBadge neutral">{entry.status}</span>
          <time dateTime={entry.createdAt}>{new Date(entry.createdAt).toLocaleDateString()}</time>
        </button>)}</div> : <p>No one is on the waitlist yet.</p>}
      {waitlist.data && <div className="growthQueueFooter"><span>{waitlist.data.totalCount} total</span><div>{cursors.length > 0 && <button type="button" className="button secondary small" onClick={() => { setSelected(null); setCursors((value) => value.slice(0, -1)); }}>Newer entries</button>}{waitlist.data.nextCursor && <button type="button" className="button secondary small" onClick={() => { setSelected(null); setCursors((value) => [...value, waitlist.data!.nextCursor!]); }}>Older entries</button>}</div></div>}
    </section>
    {selected && <section className="panel growthDetail" aria-label="Selected waitlist entry">
      <h3>{selected.email}</h3>
      <p>{selected.countryHintLabel} country: {selected.countryHint ?? "Unknown"}. This is not eligibility evidence.</p>
      {selected.status === "waiting" && !inviteCode && <form onSubmit={(event) => void issueInvite(event)}>
        <label className="fieldLabel">Verified country<input value={verifiedCountry} onChange={(event) => setVerifiedCountry(event.target.value.toUpperCase())} required maxLength={2} pattern="[A-Z]{2}" autoComplete="off" /></label>
        <label className="fieldLabel">Eligibility evidence reference<input value={eligibilityEvidence} onChange={(event) => setEligibilityEvidence(event.target.value)} required minLength={3} maxLength={200} autoComplete="off" /></label>
        {error && <p role="alert">{error}</p>}
        <button className="button primary" disabled={working}>{working ? "Issuing…" : "Issue invitation"}</button>
      </form>}
      {inviteCode && <p role="status">Copy this one-use code now: <code>{inviteCode}</code>. Send it through the approved process.</p>}
    </section>}
    <GrowthRegistry />
  </section>;
}
