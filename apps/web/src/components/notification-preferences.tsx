"use client";

import { accountEmail } from "@/lib/client/account-email";
import { useAuth } from "@/lib/client/auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { ApiError, useApi } from "@/lib/client/api";
import { marketingNoticeVersion } from "@/lib/legal/documents";
import { SettingRow, Toggle, useSettingsToast } from "./setting-row";
import { Notice } from "./states";

type PreferencesResponse = { preferences: { notifications: { transactionEmail: boolean } } };
type ConsentResponse = { consent: { marketing: boolean } };

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
type PushState = "unsupported" | "install" | "blocked" | "off" | "on" | "unavailable";

/** Why the browser refused to subscribe, in words the customer can act on. */
function pushFailure(error: unknown): string {
  const name = error instanceof DOMException ? error.name : "";
  const message = error instanceof Error ? error.message : "";
  if (name === "NotAllowedError") return "This browser blocked notifications for Aura. Allow them in the site settings, then try again.";
  if (/push service/i.test(message) || name === "AbortError")
    return "This browser's push service didn't answer. In Brave, turn on \"Use Google services for push messaging\" in Settings → Privacy.";
  return "Try again. If it keeps failing, try another browser.";
}

/** Browser push for this device: subscribe with Aura's key, and tell the server where to send. */
function useBrowserPush() {
  const api = useApi();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      const ios = /iPad|iPhone|iPod/.test(navigator.userAgent);
      const standalone = window.matchMedia?.("(display-mode: standalone)").matches;
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState(ios && !standalone ? "install" : "unsupported");
      if (Notification.permission === "denied") return setState("blocked");
      const registration = await navigator.serviceWorker.getRegistration("/sw.js");
      setState((await registration?.pushManager.getSubscription()) ? "on" : "off");
    })().catch(() => setState("unsupported"));
  }, []);
  async function turnOn() {
    setBusy(true);
    try {
      const { publicKey } = await api<{ publicKey: string | null }>("/api/notifications/push");
      if (!publicKey) return setState("unavailable");
      const permission = await Notification.requestPermission();
      if (permission === "denied") return setState("blocked");
      if (permission !== "granted") return;
      const registration = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const save = async () => {
        const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
        const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
        await api("/api/notifications/push", { method: "PUT", json: { endpoint: json.endpoint, keys: json.keys } });
        return subscription;
      };
      // This browser's subscription still belongs to another account that used it: start a fresh one for this account.
      await save().catch(async (error: unknown) => {
        if (!(error instanceof ApiError && error.code === "subscription_in_use")) throw error;
        await (await registration.pushManager.getSubscription())?.unsubscribe();
        await save();
      });
      setState("on");
    } finally { setBusy(false); }
  }
  async function turnOff() {
    setBusy(true);
    try {
      const subscription = await (await navigator.serviceWorker.getRegistration("/sw.js"))?.pushManager.getSubscription();
      if (subscription) {
        await api("/api/notifications/push", { method: "DELETE", json: { endpoint: subscription.endpoint } }).catch(() => undefined);
        await subscription.unsubscribe();
      }
      setState("off");
    } finally { setBusy(false); }
  }
  return { state, busy, turnOn, turnOff };
}

const pushNotes: Record<PushState, string> = {
  unsupported: "This browser can't show notifications.",
  install: "On iPhone and iPad, add Aura to your Home Screen (Share → Add to Home Screen), then turn them on there.",
  blocked: "Blocked for Aura in this browser's settings. Allow notifications for this site, then reload.",
  off: "Off in this browser.",
  on: "On in this browser: money received, your transactions, and security notices.",
  unavailable: "Browser notifications aren't available yet."
};

/**
 * How Aura tells the customer about their money: always in the app, by email
 * to the email on their account, and in browsers where they turn it on.
 * Security notices are always sent.
 */
export function NotificationPreferences() {
  const { user } = useAuth();
  const api = useApi();
  const client = useQueryClient();
  const toast = useSettingsToast();
  const push = useBrowserPush();
  const email = accountEmail(user)?.address;
  const preferences = useQuery({ queryKey: ["preferences", user?.id], queryFn: () => api<PreferencesResponse>("/api/preferences"), enabled: Boolean(user) });
  const consent = useQuery({ queryKey: ["consent", user?.id], queryFn: () => api<ConsentResponse>("/api/privacy/consent"), enabled: Boolean(user) });
  const saveEmail = useMutation({
    mutationFn: (transactionEmail: boolean) => api<PreferencesResponse>("/api/preferences", { method: "PATCH", json: { notifications: { transactionEmail } } }),
    onSuccess: (data) => client.setQueryData(["preferences", user?.id], data),
    onError: () => toast.error("Choice not saved", "Try again.")
  });
  const saveMarketing = useMutation({
    mutationFn: (granted: boolean) => api("/api/privacy/consent", { method: "POST", json: { purpose: "marketing", action: granted ? "granted" : "withdrawn", noticeVersion: marketingNoticeVersion } }),
    onSuccess: (_data, granted) => client.setQueryData(["consent", user?.id], { consent: { marketing: granted } }),
    onError: () => toast.error("Choice not saved", "Try again.")
  });
  const transactionEmail = preferences.data?.preferences.notifications.transactionEmail;
  const marketing = consent.data?.consent.marketing;
  // A choice that hasn't loaded shows no switch; the note under the heading says why.
  const toggle = (label: string, on: boolean | undefined, busy: boolean, change: () => void) => on === undefined
    ? null : <Toggle label={label} on={on} busy={busy} onChange={change} />;

  return <section className="mxCard stCard" id="notifications" aria-labelledby="notifications-heading"><h2 id="notifications-heading">Notifications</h2>
    <p className="mxHint">Everything shows in the app. Security notices, like a lock or a new recipient, are always sent.</p>
    {(preferences.isError || consent.isError) && <Notice tone="error" role="alert"
      onRetry={() => { void preferences.refetch(); void consent.refetch(); }}>Your email choices can&apos;t be loaded right now.</Notice>}
    <SettingRow title="Transaction emails" detail={`Money you receive, card payments, and when a send, swap, bank transfer, or Earn move completes or fails. Sent to ${email ?? "your email"}.`}>
      {toggle("Transaction emails", transactionEmail, saveEmail.isPending, () => saveEmail.mutate(!transactionEmail))}</SettingRow>
    <SettingRow title="Browser notifications" detail={push.state ? pushNotes[push.state] : "Checking this browser…"}>
      {push.state === "on" || push.state === "off"
        ? <Toggle label="Browser notifications" on={push.state === "on"} busy={push.busy}
          onChange={() => void (push.state === "on" ? push.turnOff() : push.turnOn()).catch((error: unknown) => {
            console.warn("Browser notifications", error);
            toast.error("Notifications not turned on", pushFailure(error));
          })} />
        : null}</SettingRow>
    <SettingRow title="Product news" detail="Occasional emails about what's new in Aura. Off unless you turn it on.">
      {toggle("Product news", marketing, saveMarketing.isPending || !consent.data, () => saveMarketing.mutate(!marketing))}</SettingRow>
  </section>;
}
