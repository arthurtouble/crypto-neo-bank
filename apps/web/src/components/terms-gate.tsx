"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { ExternalLink } from "lucide-react";
import { useEffect, useState } from "react";
import { accountEmail, linkEmailFailure } from "@/lib/client/account-email";
import { TERMS_REQUIRED_EVENT } from "@/lib/client/api";
import { useWallet } from "@/lib/client/wallet-context";
import { legalDocuments } from "@/lib/legal/documents";
import { AppBrand } from "./brand";
import { LoadingScreen } from "./states";
import { useSupportChat } from "./support-chat";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
type TermsResponse = { accepted: boolean };
class SessionExpired extends Error { constructor() { super("Your session expired."); } }
/** The terms changed since this page loaded: the new version comes with a reload. */
class TermsUpdated extends Error { constructor() { super("The terms were just updated. Reload to read the new version."); } }
const notSaved = "Your acceptance couldn’t be saved. Try again.";
const refusals: Record<number, string> = { 403: "Add an email to your account, then try again." };

/**
 * A full screen with no app behind it: the terms, an expired session, or an account that can't load. It can't be
 * dismissed. While support chat is open over it, it stops being modal, so the chat window can be used.
 */
function AccountScreen({ title, children, modal = true }: { title: string; children: React.ReactNode; modal?: boolean }) {
  const keep = (event: Event) => event.preventDefault();
  return <Dialog.Root open modal={modal}>
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
  const [outdated, setOutdated] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [linking, setLinking] = useState(false);
  const [linkError, setLinkError] = useState("");
  const chat = useSupportChat();
  const [chatting, setChatting] = useState(false);
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
    if (response.status === 409) throw new TermsUpdated();
    if (!response.ok) throw new Error(refusals[response.status] ?? notSaved);
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
  // Support is a page behind this screen, so the screen offers the chat itself (it works before the account loads).
  if (query.isError) return <AccountScreen title="Your account can’t be loaded right now" modal={!chatting}>
    <p>Check your connection, then try again. If it keeps happening, chat with support.</p>
    <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void query.refetch()}>Try again</button>
      {chat.status !== "unavailable" && <button type="button" className="appButton appButtonLarge" disabled={chat.status !== "ready"}
        onClick={() => { setChatting(true); chat.open("My Aura account won't load."); }}>Chat with support</button>}
      {leave("Log out")}</div></AccountScreen>;
  if (!hasEmail && !query.isError) {
    const addEmail = () => {
      setLinking(true); setLinkError("");
      // Privy sends a one-time code; once it's verified, the account has an email and this screen moves on.
      linkEmail({ onSuccess: () => setLinking(false),
        onError: (failure) => { setLinking(false); setLinkError(linkEmailFailure(failure) ?? ""); } });
    };
    return <AccountScreen title="Add your email"><p>Aura sends security notices and receipts by email. You’ll get a code by email to confirm it’s yours.</p>
      {linkError ? <p className="appFieldError" role="alert">{linkError}</p> : null}
      <div className="appScreenActions"><button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={linking} onClick={addEmail}>{linking ? "Adding…" : "Add email"}</button>
        {leave("Log out")}</div></AccountScreen>;
  }
  async function accept() {
    setSubmitting(true); setError(""); setOutdated(false);
    try {
      await call({ termsVersion: legalDocuments.terms.version, privacyVersion: legalDocuments.privacy.version });
      client.setQueryData(termsKey, { accepted: true });
      // Anything the app asked for before this (the notification bell, say) was refused until now.
      void client.invalidateQueries({ predicate: (cached) => cached.queryKey[0] !== "terms" });
    } catch (caught) { setError(caught instanceof Error ? caught.message : notSaved); setOutdated(caught instanceof TermsUpdated); }
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
    {/* An app added to the home screen has no browser reload button, so the screen offers one. */}
    <div className="appScreenActions">{outdated
      ? <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => window.location.reload()}>Reload</button>
      : <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={!agreed || submitting} onClick={() => void accept()}>{submitting ? "Saving…" : "Continue"}</button>}
      {leave("Log out")}</div>
  </AccountScreen>;
}
