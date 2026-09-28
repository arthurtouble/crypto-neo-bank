"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell, BellRing, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { useApi } from "@/lib/client/api";
import { useToast } from "./toast";

type Notifications = { transactionEmail: boolean; transactionPush: boolean };
type PreferencesResponse = { preferences: { notifications: Notifications } };

const choices: Array<{ key: keyof Notifications; label: string; note: string }> = [
  { key: "transactionEmail", label: "Transaction emails", note: "Money you receive, and when what you send, swap, or earn completes or fails." },
  { key: "transactionPush", label: "Transaction push notifications", note: "The same, in the browsers where you turn on notifications." }
];

const decode = (value: string) => Uint8Array.from(atob(value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=")), (c) => c.charCodeAt(0));
type PushState = "unsupported" | "blocked" | "off" | "on" | "unavailable";

/** Browser push for this device: subscribe with Aura's key, and tell the server where to send. */
function useBrowserPush() {
  const api = useApi();
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    void (async () => {
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return setState("unsupported");
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
      if (await Notification.requestPermission() !== "granted") return setState("blocked");
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

/** How Aura tells the customer about their money: in the app always, and by email and push as they choose. */
export function NotificationPreferences() {
  const { user } = usePrivy();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const push = useBrowserPush();
  const query = useQuery({ queryKey: ["preferences", user?.id], queryFn: () => api<PreferencesResponse>("/api/preferences"), enabled: Boolean(user) });
  const save = useMutation({
    mutationFn: (notifications: Partial<Notifications>) => api<PreferencesResponse>("/api/preferences", { method: "PATCH", json: { notifications } }),
    onSuccess: (data) => client.setQueryData(["preferences", user?.id], data),
    onError: () => toast.error("Choice not saved", "Try again.")
  });
  if (!user || !query.data) {
    return <div className="settingRow" id="notifications"><span className="settingIcon"><Bell size={17} /></span><div><strong>Notifications</strong>
      <small>{query.isError ? "Notification choices are unavailable right now." : "Loading your choices…"}</small></div><span>—</span></div>;
  }
  const current = query.data.preferences.notifications;
  const pushLabel = { unsupported: "This browser can't show notifications.", blocked: "Notifications are blocked for Aura in this browser's settings.",
    off: "Off in this browser.", on: "On in this browser.", unavailable: "Browser notifications aren't set up on this server yet." } as const;
  return <>
    {choices.map(({ key, label, note }, index) => <div className="settingRow" key={key} id={index === 0 ? "notifications" : undefined}>
      <span className="settingIcon">{index === 0 ? <Bell size={17} /> : null}</span>
      <div><strong>{label}</strong><small>{note}</small></div>
      <button className={`settingsToggle ${current[key] ? "active" : ""}`} disabled={save.isPending} aria-pressed={current[key]} aria-label={label}
        onClick={() => save.mutate({ [key]: !current[key] })}>{current[key] ? "On" : "Off"}</button>
    </div>)}
    <div className="settingRow"><span className="settingIcon"><BellRing size={17} /></span>
      <div><strong>Browser notifications</strong><small>{push.state ? pushLabel[push.state] : "Checking this browser…"} Security notices, like a lock or a new recipient, are always sent, by email and here.</small></div>
      {push.state === "on" || push.state === "off"
        ? <button className={`settingsToggle ${push.state === "on" ? "active" : ""}`} aria-pressed={push.state === "on"} aria-label="Browser notifications" disabled={push.busy}
          onClick={() => void (push.state === "on" ? push.turnOff() : push.turnOn()).catch(() => toast.error("Notifications not changed", "Try again."))}>
          {push.busy ? <LoaderCircle className="spin" size={15} /> : push.state === "on" ? "On" : "Off"}</button>
        : <span>—</span>}
    </div>
  </>;
}
