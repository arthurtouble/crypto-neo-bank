"use client";

import { Check, LoaderCircle } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { GrowthTracker } from "./growth-tracker";
import { TurnstileField } from "./turnstile-field";

type Attribution = { anonymousSessionId: string; utmSource?: string; utmMedium?: string; utmCampaign?: string; utmContent?: string; utmTerm?: string; referrerHost?: string; landingPath: string; partnerCode?: string; contentId?: string; referralCode?: string };
const subscribeToHydration = () => () => undefined;

function readAttribution(): Attribution {
  const saved = sessionStorage.getItem("aurel-growth-attribution");
  if (saved) return JSON.parse(saved) as Attribution;
  const params = new URLSearchParams(location.search);
  const anonymousSessionId = sessionStorage.getItem("aurel-growth-session") ?? crypto.randomUUID();
  sessionStorage.setItem("aurel-growth-session", anonymousSessionId);
  const attribution = {
    anonymousSessionId,
    utmSource: params.get("utm_source") || undefined,
    utmMedium: params.get("utm_medium") || undefined,
    utmCampaign: params.get("utm_campaign") || undefined,
    utmContent: params.get("utm_content") || undefined,
    utmTerm: params.get("utm_term") || undefined,
    referrerHost: document.referrer ? new URL(document.referrer).hostname : undefined,
    landingPath: location.pathname,
    partnerCode: params.get("partner") || undefined,
    contentId: params.get("content") || undefined,
    referralCode: params.get("referral")?.toUpperCase() || undefined
  };
  sessionStorage.setItem("aurel-growth-attribution", JSON.stringify(attribution));
  return attribution;
}

export function PrivateAccessApplication() {
  const [step, setStep] = useState(1);
  const ready = useSyncExternalStore(subscribeToHydration, () => true, () => false);
  const [working, setWorking] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [resetKey, setResetKey] = useState(0);
  const [assetBand, setAssetBand] = useState("");
  const heading = useRef<HTMLHeadingElement>(null);
  const errorSummary = useRef<HTMLDivElement>(null);
  const saved = useRef<Record<string, FormDataEntryValue | FormDataEntryValue[]>>({});
  useEffect(() => { heading.current?.focus(); }, [step]);
  useEffect(() => { if (error) errorSummary.current?.focus(); }, [error]);

  function next(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    saved.current = { ...saved.current, ...Object.fromEntries(form.entries()), ...(form.has("walletsChains") ? { walletsChains: form.getAll("walletsChains") } : {}) };
    setError(null); setStep((value) => Math.min(3, value + 1));
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setWorking(true); setError(null);
    const form = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/growth/applications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        email: form.get("email"), countryCode: form.get("countryCode"), primaryJob: saved.current.primaryJob, workflowFrequency: saved.current.workflowFrequency, assetBand: assetBand || null, relationshipType: saved.current.relationshipType, walletsChains: saved.current.walletsChains ?? [], desiredOutcome: form.get("desiredOutcome"), betaContactConsent: form.get("betaContactConsent") === "on", marketingConsent: form.get("marketingConsent") === "on", privacyNoticeVersion: "2026-09-22", applicationVersion: "private-access-v1", attribution: readAttribution(), turnstileToken: form.get("turnstileToken") || undefined
      }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "We could not receive your application.");
      setComplete(true);
    } catch (caught) { setError(caught instanceof Error ? caught.message : "We could not receive your application."); setResetKey((value) => value + 1); }
    finally { setWorking(false); }
  }

  if (complete) return <section className="applicationCard applicationSuccess" role="status" aria-live="polite"><span><Check size={24} /></span><p className="eyebrow">RECEIVED</p><h2>Thank you.</h2><p>We review each application by hand. If this cohort is a fit, we’ll contact you with the next step. Applying does not guarantee access.</p><a className="button primary" href="/tour">Explore Aurel</a></section>;

  return <section className="applicationCard"><GrowthTracker eventName="application_started" /><div className="applicationProgress" role="progressbar" aria-label="Application progress" aria-valuemin={1} aria-valuemax={3} aria-valuenow={step} aria-valuetext={`Step ${step} of 3`}><span className={step >= 1 ? "active" : ""} /><span className={step >= 2 ? "active" : ""} /><span className={step >= 3 ? "active" : ""} /></div>
    {step === 1 && <form onSubmit={next}><h2 ref={heading} tabIndex={-1}>Your priorities</h2><p>What would make Aurel useful to you?</p><label className="fieldLabel">Main goal<select name="primaryJob" required defaultValue=""><option value="" disabled>Choose one</option><option value="see">See everything together</option><option value="protect">Improve safety and control</option><option value="receive">Receive digital dollars</option><option value="move">Move money with fewer steps</option><option value="earn">Earn on available assets</option><option value="spend">Spend from one account</option><option value="treasury">Manage company treasury</option><option value="other">Something else</option></select></label><label className="fieldLabel">How often does this come up?<select name="workflowFrequency" required defaultValue=""><option value="" disabled>Choose one</option><option value="daily">Daily</option><option value="weekly">Weekly</option><option value="monthly">Monthly</option><option value="occasional">Occasionally</option><option value="not_yet">Not yet</option></select></label><button className="button primary full" disabled={!ready}>Continue</button></form>}
    {step === 2 && <form onSubmit={next}><h2 ref={heading} tabIndex={-1}>Your setup</h2><p>Choose broad categories only. Never share an address, account number, or recovery phrase.</p><fieldset className="choiceField"><legend>What do you use today?</legend><label><input type="checkbox" name="walletsChains" value="base" /> Base</label><label><input type="checkbox" name="walletsChains" value="ethereum" /> Ethereum</label><label><input type="checkbox" name="walletsChains" value="external_wallet" /> Self-custody wallet</label><label><input type="checkbox" name="walletsChains" value="exchange" /> Exchange</label><label><input type="checkbox" name="walletsChains" value="custodian" /> Custodian</label><label><input type="checkbox" name="walletsChains" value="none" /> None yet</label></fieldset><label className="fieldLabel">Relationship<select name="relationshipType" required defaultValue="individual"><option value="individual">Individual</option><option value="family">Family</option><option value="company">Company</option></select></label><label className="fieldLabel">Approximate asset band <small>Optional. This helps us build balanced cohorts.</small><select value={assetBand} onChange={(event) => setAssetBand(event.target.value)}><option value="">Prefer not to answer</option><option value="under_25k">Under $25,000</option><option value="25k_100k">$25,000–$100,000</option><option value="100k_500k">$100,000–$500,000</option><option value="over_500k">Over $500,000</option></select></label><div className="formNav"><button type="button" className="button secondary" onClick={() => setStep(1)}>Back</button><button className="button primary" disabled={!ready}>Continue</button></div></form>}
    {step === 3 && <form onSubmit={(event) => void submit(event)}><h2 ref={heading} tabIndex={-1}>Contact</h2><p>Tell us the outcome you want, then review your contact preferences.</p><label className="fieldLabel">What would a better experience look like?<textarea name="desiredOutcome" required minLength={10} maxLength={500} placeholder="For example: see balances and move USD Coin without managing every network." /></label><div className="formPair"><label className="fieldLabel">Email<input name="email" type="email" required autoComplete="email" /></label><label className="fieldLabel">Country<select name="countryCode" required defaultValue="PT"><option value="PT">Portugal</option><option value="CH">Switzerland</option><option value="GB">United Kingdom</option><option value="US">United States</option><option value="AE">United Arab Emirates</option><option value="OTHER">Other</option></select></label></div><label className="consentCheck"><input name="betaContactConsent" type="checkbox" required /><span><strong>Private-access contact</strong><small>I agree that Aurel may contact me about this application and private-beta operations. Required.</small></span></label><label className="consentCheck"><input name="marketingConsent" type="checkbox" /><span><strong>Product updates</strong><small>I’d also like occasional product and trust updates. Optional and not required for access.</small></span></label><p className="applicationPrivacy">By submitting, you confirm you’ve read the <a href="https://aurel-docs.aurel-events.workers.dev/legal/privacy-notice/">Privacy Notice</a>. Do not include financial account details or wallet addresses.</p><TurnstileField action="private_access_application" resetKey={resetKey} />{error && <div className="formError" ref={errorSummary} tabIndex={-1} role="alert">{error}</div>}<div className="formNav"><button type="button" className="button secondary" onClick={() => setStep(2)}>Back</button><button className="button primary" disabled={working}>{working ? <LoaderCircle className="spin" size={16} /> : null}{working ? "Sending" : "Submit Application"}</button></div></form>}
  </section>;
}
