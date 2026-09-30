"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink } from "lucide-react";
import { useState } from "react";
import { legalDocuments } from "@/lib/legal/documents";
import { AppBrand } from "./brand";
import { LoadingScreen } from "./states";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
type TermsResponse = { accepted: boolean };
class SessionExpired extends Error { constructor() { super("Your session expired."); } }

/** A full screen with no app behind it: the terms, an expired session, or an account that can't load. It can't be dismissed. */
function AccountScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const keep = (event: Event) => event.preventDefault();
  return <Dialog.Root open>
    <Dialog.Portal>
      <Dialog.Content className="appScreen" onEscapeKeyDown={keep} onPointerDownOutside={keep} onInteractOutside={keep} aria-describedby={undefined}>
        <div className="appScreenBody"><AppBrand /><Dialog.Title asChild><h1>{title}</h1></Dialog.Title>{children}</div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>;
}

/** Signed-in customers accept the current terms once per version before personal features load. */
export function TermsGate({ children }: { children: React.ReactNode }) {
  const { authenticated, user, getAccessToken, login, logout } = usePrivy();
  const client = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const call = async (body?: unknown) => {
    const token = await getAccessToken();
    const response = await fetch("/api/terms", { method: body ? "POST" : "GET", cache: "no-store", body: body ? JSON.stringify(body) : undefined,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } });
    if (response.status === 401) throw new SessionExpired();
    if (!response.ok) throw new Error(response.status === 409 ? "The terms were just updated. Reload to review the current version." : "We couldn't confirm your acceptance.");
    return response.json() as Promise<TermsResponse>;
  };
  const query = useQuery({ queryKey: ["terms", user?.id], queryFn: () => call(), enabled: authenticated, retry: false });
  if (!authenticated || query.data?.accepted) return children;
  if (query.isPending) return <LoadingScreen label="Loading your account" />;
  if (query.error instanceof SessionExpired) return <AccountScreen title="Your session expired">
    <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void logout().then(() => login())}>Sign in again</button></AccountScreen>;
  if (query.isError) return <AccountScreen title="We couldn’t load your account"><p>Check your connection, then try again. If it keeps happening, contact support.</p>
    <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void query.refetch()}>Try again</button></AccountScreen>;
  async function accept() {
    setSubmitting(true); setError("");
    try {
      await call({ termsVersion: legalDocuments.terms.version, privacyVersion: legalDocuments.privacy.version });
      client.setQueryData(["terms", user?.id], { accepted: true });
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We couldn't confirm your acceptance."); }
    finally { setSubmitting(false); }
  }
  const documents = [
    { label: "Terms of use", href: `${docs}${legalDocuments.terms.path}` },
    { label: "Privacy notice", href: `${docs}${legalDocuments.privacy.path}` },
    { label: "Risk disclosure", href: `${docs}/legal/risk-disclosure/` }
  ];
  return <AccountScreen title="Review Aura’s terms">
    <p>Aura helps you use your own wallet. You approve every transaction, blockchain transactions can be irreversible, and bank, card, and securities services come from separate providers under their own terms.</p>
    <ul className="appDocList">{documents.map((item) => <li key={item.label}><a href={item.href} target="_blank" rel="noreferrer">{item.label}<ExternalLink aria-hidden="true" /></a></li>)}</ul>
    <label className="appCheck"><input type="checkbox" checked={agreed} onChange={(event) => setAgreed(event.target.checked)} />
      <span>I agree to the Terms of use and have read the Privacy notice and Risk disclosure.</span></label>
    {error ? <p className="appFieldError" role="alert">{error}</p> : null}
    <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={!agreed || submitting} onClick={() => void accept()}>{submitting ? "Saving…" : "Continue"}</button>
  </AccountScreen>;
}
