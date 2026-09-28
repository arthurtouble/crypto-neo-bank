"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BellRing, LoaderCircle, Mail, Megaphone } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import { marketingNoticeVersion } from "@/lib/legal/documents";
import { useToast } from "./toast";

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
      const subscription = await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: decode(publicKey) });
      const json = subscription.toJSON() as { endpoint: string; keys: { p256dh: string; auth: string } };
      await api("/api/notifications/push", { method: "PUT", json: { endpoint: json.endpoint, keys: json.keys } });
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
  unavailable: "Browser notifications aren't set up on this server yet."
};

/**
 * How Aura tells the customer about their money: always in the app, by email
 * to the email on their account, and in browsers where they turn it on.
 * Security notices are always sent.
 */
export function NotificationPreferences() {
  const { user } = usePrivy();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const push = useBrowserPush();
  const email = user?.email?.address;
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
  const toggle = (label: string, on: boolean | undefined, busy: boolean, change: () => void) => on === undefined
    ? <span>—</span>
    : <button className={`settingsToggle ${on ? "active" : ""}`} aria-pressed={on} aria-label={label} disabled={busy} onClick={change}>{busy ? <LoaderCircle className="spin" size={15} /> : on ? "On" : "Off"}</button>;

  return <section className="panel settingsPanel" id="notifications" aria-labelledby="notifications-heading"><h2 id="notifications-heading">Notifications</h2>
    <p className="sourceCaption">Everything shows in the app. Security notices, like a lock or a new recipient, are always sent.</p>
    <div className="settingRow"><span className="settingIcon"><Mail size={17} /></span>
      <div><strong>Transaction emails</strong><small>{email ? `Money you receive, and when a send, swap, or Earn move completes or fails. Sent to ${email}.` : "Add an email above to get notices by email."}</small></div>
      {email ? toggle("Transaction emails", transactionEmail, saveEmail.isPending, () => saveEmail.mutate(!transactionEmail))
        : <a href="#email">Add email</a>}</div>
    <div className="settingRow"><span className="settingIcon"><BellRing size={17} /></span>
      <div><strong>Browser notifications</strong><small>{push.state ? pushNotes[push.state] : "Checking this browser…"}</small></div>
      {push.state === "on" || push.state === "off"
        ? <button className={`settingsToggle ${push.state === "on" ? "active" : ""}`} aria-pressed={push.state === "on"} aria-label="Browser notifications" disabled={push.busy}
          onClick={() => void (push.state === "on" ? push.turnOff() : push.turnOn()).catch((error: unknown) => {
            console.warn("Browser notifications", error);
            toast.error("Notifications not turned on", pushFailure(error));
          })}>
          {push.busy ? <LoaderCircle className="spin" size={15} /> : push.state === "on" ? "On" : "Off"}</button>
        : <span>—</span>}</div>
    {email && <div className="settingRow"><span className="settingIcon"><Megaphone size={17} /></span>
      <div><strong>Product news</strong><small>Occasional emails about what&apos;s new in Aura. Off unless you turn it on.</small></div>
      {toggle("Product news", marketing, saveMarketing.isPending || !consent.data, () => saveMarketing.mutate(!marketing))}</div>}
  </section>;
}
