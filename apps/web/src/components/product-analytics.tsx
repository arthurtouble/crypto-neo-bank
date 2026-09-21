"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { useEffect } from "react";

export function ProductAnalytics() {
  const pathname = usePathname();
  const { authenticated, getAccessToken } = usePrivy();
  useEffect(() => {
    if (!authenticated || !pathname.startsWith("/app")) return;
    let active = true;
    async function capture() {
      const token = await getAccessToken();
      if (!active || !token) return;
      await fetch("/api/analytics/events", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ eventName: "product_viewed", surface: pathname, properties: {} }), keepalive: true }).catch(() => undefined);
    }
    void capture();
    return () => { active = false; };
  }, [authenticated, getAccessToken, pathname]);
  return null;
}
