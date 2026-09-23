"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { TurnstileField } from "./turnstile-field";
import { WaitlistConfetti } from "./waitlist-confetti";

const docsUrl = "https://aurel-docs.aurel-events.workers.dev";
const subscribeToHydration = () => () => undefined;

function attribution() {
  const params = new URLSearchParams(window.location.search);
  const limited = (key: string) => params.get(key)?.trim().slice(0, 120) || undefined;
  const partnerCode = limited("partner");
  const referralCode = limited("referral")?.toUpperCase();
  return {
    ...(limited("utm_source") ? { utmSource: limited("utm_source") } : {}),
    ...(limited("utm_campaign") ? { utmCampaign: limited("utm_campaign") } : {}),
    ...(partnerCode && /^[a-z0-9-]{2,80}$/.test(partnerCode) ? { partnerCode } : {}),
    ...(referralCode && /^AUREL-[A-Z0-9]+$/.test(referralCode) ? { referralCode } : {})
  };
}

export function WaitlistForm({ privacyNoticeVersion }: { privacyNoticeVersion: string }) {
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [working, setWorking] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [burst, setBurst] = useState(false);
  const [resetKey, setResetKey] = useState(0);
  const submitting = useRef(false);
  const timeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const errorMessage = useRef<HTMLParagraphElement>(null);
  useEffect(() => () => { if (timeout.current) clearTimeout(timeout.current); }, []);
  useEffect(() => { if (error) errorMessage.current?.focus(); }, [error]);

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current || complete) return;
    submitting.current = true;
    setWorking(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/growth/waitlist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: data.get("email"), privacyNoticeVersion, attribution: attribution(), turnstileToken: data.get("turnstileToken") || undefined
      }) });
      if (response.status !== 202) {
        const body = await response.json().catch(() => ({})) as { message?: string };
        throw new Error(body.message || "We couldn't add you right now. Please try again.");
      }
      setComplete(true);
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        setBurst(true);
        timeout.current = setTimeout(() => setBurst(false), 2000);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We couldn't add you right now. Please try again.");
      setResetKey((value) => value + 1);
    } finally {
      submitting.current = false;
      setWorking(false);
    }
  }

  if (complete) return <section className="waitlistCard waitlistSuccess" aria-live="polite">
    <span className="waitlistSuccessMark" aria-hidden="true">✓</span>
    <h2>{"You're on the waitlist."}</h2>
    <p role="status">Thanks for joining. We’ll be in touch if we can offer you access. Joining doesn’t guarantee an invitation.</p>
    <a href={docsUrl}>Explore the documentation <span aria-hidden="true">↗</span></a>
    <WaitlistConfetti active={burst} />
  </section>;

  return <form className="waitlistCard" onSubmit={(event) => void submit(event)}>
    <p className="eyebrow">PRIVATE BETA</p>
    <h2>Get the first look.</h2>
    <p>Join the global waitlist with your email. We’re opening access gradually, where the product is available.</p>
    <label className="fieldLabel" htmlFor="waitlist-email">Email</label>
    <input id="waitlist-email" name="email" type="email" autoComplete="email" placeholder="you@example.com" required maxLength={254} />
    <TurnstileField action="waitlist_signup" resetKey={resetKey} />
    <button className="button dark" type="submit" disabled={!ready || working}>{working ? "Joining…" : "Join waitlist"}</button>
    {error && <p className="waitlistError" ref={errorMessage} tabIndex={-1} role="alert">{error}</p>}
    <small>By joining, you acknowledge our <a href={`${docsUrl}/legal/privacy-notice/`}>Privacy Notice</a>. No account or deposit is needed.</small>
  </form>;
}
