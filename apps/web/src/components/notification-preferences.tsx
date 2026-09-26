"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import { useToast } from "./toast";

type Notifications = { transactionEmail: boolean; transactionPush: boolean };
type PreferencesResponse = { preferences: { notifications: Notifications }; delivery: string };

const choices: Array<{ key: keyof Notifications; label: string }> = [
  { key: "transactionEmail", label: "Transaction emails" },
  { key: "transactionPush", label: "Transaction push notifications" }
];

/** Saved notification choices; delivery starts once a notification service is connected. */
export function NotificationPreferences() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const toast = useToast();
  const request = async (init?: RequestInit) => {
    const token = await getAccessToken();
    const response = await fetch("/api/preferences", { ...init, cache: "no-store",
      headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(init?.body ? { "Content-Type": "application/json" } : {}) } });
    if (!response.ok) throw new Error("Notification choices could not be saved.");
    return response.json() as Promise<PreferencesResponse>;
  };
  const query = useQuery({ queryKey: ["preferences", user?.id], queryFn: () => request(), enabled: Boolean(user) });
  const save = useMutation({
    mutationFn: (notifications: Partial<Notifications>) => request({ method: "PATCH", body: JSON.stringify({ notifications }) }),
    onSuccess: (data) => client.setQueryData(["preferences", user?.id], data),
    onError: (error) => toast.error("Choice not saved", error.message)
  });
  if (!user || !query.data) {
    return <div className="settingRow"><span className="settingIcon"><Bell size={17} /></span><div><strong>Notifications</strong>
      <small>{query.isError ? "Notification choices are unavailable right now." : "Sign in to choose how Aura contacts you."}</small></div><span>—</span></div>;
  }
  const current = query.data.preferences.notifications;
  return <>{choices.map(({ key, label }, index) => <div className="settingRow" key={key}>
    <span className="settingIcon">{index === 0 ? <Bell size={17} /> : null}</span>
    <div><strong>{label}</strong>{index === 0 ? <small>{query.data.delivery}</small> : null}</div>
    <button className={`settingsToggle ${current[key] ? "active" : ""}`} disabled={save.isPending} aria-pressed={current[key]}
      onClick={() => save.mutate({ [key]: !current[key] })}>{current[key] ? "On" : "Off"}</button>
  </div>)}</>;
}
