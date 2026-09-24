"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, LockKeyhole } from "lucide-react";
import { FormEvent, useState } from "react";

type AccessResponse = { access: { allowed: boolean; mode: "preview" | "invite"; status: string; cohort: string; transactionLimitUsd: number; termsVersion: string } };

export function BetaAccessGate({ children }: { children: React.ReactNode }) {
  const { authenticated, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [code, setCode] = useState("");
  const [countryCode, setCountryCode] = useState("");
  const [accepted, setAccepted] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const query = useQuery<AccessResponse>({ queryKey: ["beta-access"], enabled: authenticated, retry: false, queryFn: async () => { const token = await getAccessToken(); const response = await fetch("/api/beta/access", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" }); if (!response.ok) throw new Error("Private-beta access could not be verified."); return response.json(); } });
  if (!authenticated) return children;
  if (query.isPending) return <div className="accessState" role="status"><span className="accessPulse" /><p>Verifying product access…</p></div>;
  if (query.isError) return <section className="accessGate"><div className="accessGateMark"><LockKeyhole size={24} /></div><p className="eyebrow">Access check</p><h1>We could not verify access.</h1><p>{query.error.message}</p><button className="button primary" onClick={() => void query.refetch()}>Try again</button></section>;
  if (query.data.access.allowed) return children;
  if (query.data.access.status === "country_unavailable") return <section className="accessGate"><div className="accessGateMark"><LockKeyhole size={24} /></div><p className="eyebrow">Private beta</p><h1>Not available in your country yet.</h1><p>Your invitation is still on file. Check back for updates.</p><button className="button primary" onClick={() => void query.refetch()}>Check again</button></section>;
  async function redeem(event: FormEvent) {
    event.preventDefault(); setError(""); setSubmitting(true);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/beta/access", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ code, countryCode, acceptTerms: accepted }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "This invitation could not be accepted.");
      await client.invalidateQueries({ queryKey: ["beta-access"] });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "This invitation could not be accepted."); }
    finally { setSubmitting(false); }
  }
  return <section className="accessGate betaGate"><div className="accessGateMark"><LockKeyhole size={24} /></div><p className="eyebrow">Private beta</p><h1>Enter your invitation.</h1><p>Aurel is opening access in small cohorts while we test real mainnet workflows and support.</p><form className="betaInviteForm" onSubmit={(event) => void redeem(event)}><label><span>Invitation code</span><input value={code} onChange={(event) => setCode(event.target.value)} autoComplete="one-time-code" placeholder="AUREL-••••••" required /></label><label><span>Country</span><input value={countryCode} onChange={(event) => setCountryCode(event.target.value.toUpperCase())} placeholder="PT" maxLength={2} required /></label><label className="betaConsent"><input type="checkbox" checked={accepted} onChange={(event) => setAccepted(event.target.checked)} required /><span>I accept the private-beta terms and understand that mainnet transactions use real assets.</span></label>{error && <p className="formError" role="alert">{error}</p>}<button className="button primary" disabled={submitting || !accepted}>{submitting ? "Checking invitation…" : "Enter private beta"}</button></form><div className="accessAssurances"><span><CheckCircle2 size={15} /> No deposit minimum</span><span><CheckCircle2 size={15} /> Customer-controlled wallet</span></div></section>;
}
