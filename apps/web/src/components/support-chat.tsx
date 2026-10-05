"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { usePathname } from "next/navigation";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useApi } from "@/lib/client/api";

type MessengerSession = { appId: string | null; userId?: string; token?: string; walletAddress?: string };
type IntercomFn = ((command: string, ...args: unknown[]) => void) & { q?: unknown[][]; c?: (args: unknown[]) => void };
declare global { interface Window { Intercom?: IntercomFn; intercomSettings?: Record<string, unknown> } }

type SupportChat = { status: "loading" | "ready" | "unavailable"; open: (message?: string) => void; retry: () => void };
const SupportChatContext = createContext<SupportChat>({ status: "unavailable", open: () => undefined, retry: () => undefined });

type Widget = "loading" | "loaded" | "failed";

/**
 * Intercom's documented loader: queue calls until the widget script arrives. Reports whether the script loaded,
 * since an ad blocker, the network, or the Content Security Policy can stop it, and then nothing would open.
 */
function loadIntercom(appId: string, done: (widget: Widget) => void) {
  if (window.Intercom) { done("loaded"); return; }
  const queue: IntercomFn = ((...args: unknown[]) => { queue.c?.(args); }) as IntercomFn;
  queue.q = [];
  queue.c = (args) => { queue.q!.push(args); };
  window.Intercom = queue;
  const script = document.createElement("script");
  script.async = true;
  script.src = `https://widget.intercom.io/widget/${encodeURIComponent(appId)}`;
  script.onload = () => done("loaded");
  script.onerror = () => { script.remove(); delete window.Intercom; done("failed"); };
  document.head.appendChild(script);
}

/**
 * Support chat for the signed-in customer: Intercom's Messenger, with Fin
 * answering first and the team taking over. The customer is identified by a
 * token the server signs, refreshed before it expires. Signing out ends the
 * Intercom session, so the next person on the device starts clean. Chat
 * counts as ready only once Intercom's script has loaded. When it isn't,
 * `retry` asks for a new session and loads the script again, without
 * reloading the page.
 */
export function SupportChatProvider({ children }: { children: ReactNode }) {
  const { user, getAccessToken } = useAuth();
  const api = useApi();
  const pathname = usePathname();
  const bootedFor = useRef<string | null>(null);
  const [widget, setWidget] = useState<Widget>("loading");
  const [attempt, setAttempt] = useState(0);
  const session = useQuery({ queryKey: ["support-messenger", user?.id], queryFn: () => api<MessengerSession>("/api/support/messenger"),
    enabled: Boolean(user), staleTime: 50 * 60_000, refetchInterval: 50 * 60_000, retry: 1 });
  const { data, refetch } = session;
  const identified = Boolean(data?.appId && data.token && data.userId);
  const ready = identified && widget === "loaded";

  useEffect(() => {
    if (!data?.appId || !data.token || !data.userId) return;
    const settings = { api_base: "https://api-iam.intercom.io", app_id: data.appId, user_id: data.userId, intercom_user_jwt: data.token,
      wallet_address: data.walletAddress, hide_default_launcher: true };
    window.intercomSettings = settings;
    // A fresh token for the same customer only updates the session.
    if (bootedFor.current === data.userId) { window.Intercom?.("update", { intercom_user_jwt: data.token }); return; }
    if (bootedFor.current) window.Intercom?.("shutdown");
    setWidget("loading");
    loadIntercom(data.appId, setWidget);
    window.Intercom?.("boot", settings);
    bootedFor.current = data.userId;
  }, [data, attempt]);

  // End the Intercom session when the customer signs out or leaves the app.
  useEffect(() => { if (!user && bootedFor.current) { window.Intercom?.("shutdown"); bootedFor.current = null; } }, [user]);
  useEffect(() => () => { if (bootedFor.current) { window.Intercom?.("shutdown"); bootedFor.current = null; } }, []);

  const open = useCallback((message?: string) => {
    if (!ready) return;
    if (message) window.Intercom?.("showNewMessage", message); else window.Intercom?.("show");
    // "support opened", one of the product events the privacy notice lists. Best effort.
    void getAccessToken().then((token) => token ? fetch("/api/analytics/events", { method: "POST", keepalive: true,
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ eventName: "support_opened", surface: pathname, properties: { prefilled: Boolean(message) } }) }) : null).catch(() => undefined);
  }, [ready, getAccessToken, pathname]);
  const retry = useCallback(() => {
    // Boot again from scratch: a script that failed to load was removed, so it's fetched again.
    bootedFor.current = null;
    setWidget("loading");
    setAttempt((value) => value + 1);
    void refetch();
  }, [refetch]);
  const status: SupportChat["status"] = !user || session.isPending || (session.isFetching && !ready) || (identified && widget === "loading") ? "loading"
    : ready ? "ready" : "unavailable";
  const value = useMemo(() => ({ status, open, retry }), [status, open, retry]);
  return <SupportChatContext.Provider value={value}>{children}</SupportChatContext.Provider>;
}

export const useSupportChat = () => useContext(SupportChatContext);
