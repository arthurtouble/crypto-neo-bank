"use client";

import Script from "next/script";
import { useCallback, useEffect, useRef, useState } from "react";

type TurnstileWidgetId = string;
type TurnstileApi = {
  render: (container: HTMLElement, options: {
    sitekey: string;
    action: string;
    theme: "auto";
    size: "flexible";
    callback: (token: string) => void;
    "expired-callback": () => void;
    "error-callback": () => void;
  }) => TurnstileWidgetId;
  reset: (widgetId: TurnstileWidgetId) => void;
};

const configuredSiteKey = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY;
const localTestSiteKey = "1x00000000000000000000AA";

export function TurnstileField({ action, resetKey = 0 }: { action: string; resetKey?: number }) {
  const siteKey = process.env.NODE_ENV === "production" ? configuredSiteKey : localTestSiteKey;
  const container = useRef<HTMLDivElement>(null);
  const widgetId = useRef<TurnstileWidgetId | null>(null);
  const [token, setToken] = useState("");

  const render = useCallback(() => {
    const turnstile = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (!siteKey || !container.current || !turnstile || widgetId.current) return;
    widgetId.current = turnstile.render(container.current, {
      sitekey: siteKey,
      action,
      theme: "auto",
      size: "flexible",
      callback: setToken,
      "expired-callback": () => setToken(""),
      "error-callback": () => setToken("")
    });
  }, [action, siteKey]);

  useEffect(() => { render(); }, [render]);
  useEffect(() => {
    const turnstile = (window as unknown as { turnstile?: TurnstileApi }).turnstile;
    if (!widgetId.current || !turnstile) return;
    turnstile.reset(widgetId.current);
    setToken("");
  }, [resetKey]);

  if (!siteKey) return null;
  return <>
    <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit" strategy="afterInteractive" onReady={render} />
    <div ref={container} />
    <input type="hidden" name="turnstileToken" value={token} readOnly />
  </>;
}
