"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { accountEmail } from "@/lib/client/account-email";
import { TERMS_REQUIRED_EVENT } from "@/lib/client/api";
import { useWallet } from "@/lib/client/wallet-context";
import { legalDocuments } from "@/lib/legal/documents";
import { AppBrand } from "./brand";
import { LoadingScreen } from "./states";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
type TermsResponse = { accepted: boolean };
class SessionExpired extends Error { constructor() { super("Your session expired."); } }
const refusals: Record<number, string> = {
  403: "Add an email to your account, then try again.",
  409: "The terms were just updated. Reload to review the current version."
};

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

/**
 * Before personal features load, a signed-in customer has an email on their account (a Telegram or wallet sign-in
 * adds one here, verified by Privy) and has accepted the current terms, once per version. The server enforces both:
 * `/api/terms` refuses acceptance without an email, and every other customer route refuses until it's recorded
 * (`requireVerifiedSubject`).
 */
export function TermsGate({ children }: { children: React.ReactNode }) {
  const { authenticated, user, getAccessToken, login, logout } = useAuth();
  const { linkEmail } = useWallet();
  const client = useQueryClient();
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const termsKey = ["terms", user?.id];
  // The server asked for the terms (a new version since this page loaded): check again, which shows them.
  useEffect(() => {
    const onRequired = () => void client.invalidateQueries({ queryKey: ["terms"] });
    window.addEventListener(TERMS_REQUIRED_EVENT, onRequired);
    return () => window.removeEventListener(TERMS_REQUIRED_EVENT, onRequired);
  }, [client]);
  const call = async (body?: unknown) => {
    const token = await getAccessToken();
    const response = await fetch("/api/terms", { method: body ? "POST" : "GET", cache: "no-store", body: body ? JSON.stringify(body) : undefined,
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(body ? { "Content-Type": "application/json" } : {}) } });
    if (response.status === 401) throw new SessionExpired();
    if (!response.ok) throw new Error(refusals[response.status] ?? "We couldn't confirm your acceptance.");
    return response.json() as Promise<TermsResponse>;
  };
  const hasEmail = accountEmail(user) !== null;
  const query = useQuery({ queryKey: termsKey, queryFn: () => call(), enabled: authenticated, retry: false });
  if (!authenticated || (hasEmail && query.data?.accepted)) return children;
  if (query.isPending) return <LoadingScreen label="Loading your account" />;
  // Every screen has a way out: logging out leaves the example data, so no one is held on a screen they can't pass.
  const leave = (label: string) => <button type="button" className="appButton appButtonLarge" onClick={() => void logout()}>{label}</button>;
  if (query.error instanceof SessionExpired) return <AccountScreen title="Your session expired"><p>Sign in again to keep using your account.</p>
    <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void logout().then(() => login())}>Sign in again</button>
      {leave("Not now")}</div></AccountScreen>;
  if (query.isError) return <AccountScreen title="We couldn’t load your account"><p>Check your connection, then try again. If it keeps happening, contact support.</p>
    <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void query.refetch()}>Try again</button>
      {leave("Sign out")}</div></AccountScreen>;
  if (!hasEmail && !query.isError) {
    const addEmail = () => {
      setLinking(true); setLinkError("");
      // Privy sends a one-time code; once it's verified, the account has an email and this screen moves on.
      linkEmail({ onSuccess: () => setLinking(false),
        onError: (failure) => { setLinking(false); if (failure !== "exited_link_flow") setLinkError("We couldn't add that email. Try again."); } });
    };
    return <AccountScreen title="Add your email"><p>Aura sends security notices and receipts by email. We&apos;ll send a code to check it&apos;s yours.</p>
      {linkError ? <p className="appFieldError" role="alert">{linkError}</p> : null}
      <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={linking} onClick={addEmail}>{linking ? "Adding…" : "Add email"}</button>
        {leave("Sign out")}</div></AccountScreen>;
  }
  async function accept() {
    setSubmitting(true); setError("");
    try {
      await call({ termsVersion: legalDocuments.terms.version, privacyVersion: legalDocuments.privacy.version });
      client.setQueryData(termsKey, { accepted: true });
      // Anything the app asked for before this (the notification bell, say) was refused until now.
      void client.invalidateQueries({ predicate: (cached) => cached.queryKey[0] !== "terms" });
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
    <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={!agreed || submitting} onClick={() => void accept()}>{submitting ? "Saving…" : "Continue"}</button>
      {leave("Sign out")}</div>
  </AccountScreen>;
}
