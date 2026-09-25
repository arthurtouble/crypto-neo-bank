"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText } from "lucide-react";
import { useState } from "react";
import { legalDocuments } from "@/lib/legal/documents";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
type TermsResponse = { accepted: boolean };

/** Signed-in customers accept the current terms once per version before personal features load. */
export function TermsGate({ children }: { children: React.ReactNode }) {
  const { authenticated, user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const call = async (body?: unknown) => {
    const token = await getAccessToken();
    const response = await fetch("/api/terms", { method: body ? "POST" : "GET", cache: "no-store", body: body ? JSON.stringify(body) : undefined,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } });
    if (!response.ok) throw new Error(response.status === 409 ? "The terms were just updated. Reload to review the current version." : "We couldn't confirm your acceptance.");
    return response.json() as Promise<TermsResponse>;
  };
  const query = useQuery({ queryKey: ["terms", user?.id], queryFn: () => call(), enabled: authenticated, retry: false });
  if (!authenticated || query.data?.accepted) return children;
  if (query.isPending) return <div className="accessState" role="status"><span className="accessPulse" /><p>Loading your account…</p></div>;
  if (query.isError) return <section className="accessGate"><p className="eyebrow">Account</p><h1>We couldn’t load your account.</h1><p>{query.error.message}</p>
    <button className="button primary" onClick={() => void query.refetch()}>Try again</button></section>;
  async function accept() {
    setSubmitting(true); setError("");
    try {
      await call({ termsVersion: legalDocuments.terms.version, privacyVersion: legalDocuments.privacy.version });
      client.setQueryData(["terms", user?.id], { accepted: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We couldn't confirm your acceptance."); }
    finally { setSubmitting(false); }
  }
  return <section className="accessGate termsGate"><div className="accessGateMark"><FileText size={24} /></div><p className="eyebrow">Before you continue</p>
    <h1>Review Aura’s terms.</h1>
    <p>Aura helps you use your own wallet. You approve every transaction, blockchain transactions can be irreversible, and bank, card, and securities services come from separate providers under their own terms.</p>
    <label className="termsConsent"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
      <span>I agree to the <a href={`${docs}${legalDocuments.terms.path}`} target="_blank" rel="noreferrer">Terms of use</a> and have read the <a href={`${docs}${legalDocuments.privacy.path}`} target="_blank" rel="noreferrer">Privacy notice</a> and <a href={`${docs}/legal/risk-disclosure/`} target="_blank" rel="noreferrer">Risk disclosure</a>.</span></label>
    {error ? <p className="formError" role="alert">{error}</p> : null}
    <button className="button primary" disabled={!agreed || submitting} onClick={() => void accept()}>{submitting ? "Saving…" : "Continue"}</button></section>;
}
