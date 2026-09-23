"use client";

import { useEffect } from "react";

export function GrowthTracker({ eventName, contentId }: { eventName: "landing_viewed" | "waitlist_viewed"; contentId?: string }) {
  useEffect(() => {
    try {
      const key = "aurel-growth-session"; const anonymousSessionId = sessionStorage.getItem(key) ?? crypto.randomUUID(); sessionStorage.setItem(key, anonymousSessionId);
      const controller = new AbortController();
      void fetch("/api/growth/events", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ events: [{ eventName, anonymousSessionId, surface: location.pathname, contentId, properties: { viewport: innerWidth < 650 ? "mobile" : "desktop" } }] }), keepalive: true, signal: controller.signal }).catch(() => undefined);
      return () => controller.abort();
    } catch { return undefined; }
  }, [contentId, eventName]);
  return null;
}
