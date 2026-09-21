"use client";

import Script from "next/script";

const siteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;

export function TurnstileField({ action }: { action: string }) {
  if (!siteKey) return null;
  return <><Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" /><div className="cf-turnstile" data-sitekey={siteKey} data-theme="auto" data-size="flexible" data-action={action} data-response-field-name="turnstileToken" /></>;
}
