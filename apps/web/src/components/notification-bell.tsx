"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/client/api";
import type { NotificationView } from "@/lib/notifications/store";
import { useToast } from "./toast";

type Inbox = { notifications: NotificationView[]; unread: number };

/**
 * The bell in the header: unread notices, a list of the latest, and a toast
 * for each notice that arrives while the customer is in the app. Checking also
 * picks up money received (`GET /api/notifications`).
 */
export function NotificationBell() {
  const { user } = usePrivy();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const seen = useRef<Set<string> | null>(null);
  // Checked every 30 seconds, and whenever the customer comes back to the tab.
  const inbox = useQuery({ queryKey: ["notifications", user?.id], queryFn: () => api<Inbox>("/api/notifications"), enabled: Boolean(user),
    refetchInterval: 30_000, refetchOnWindowFocus: "always" });

  // Toast notices that are new since the first load; the first load itself is history. The customer's own
  // transactions already get a toast from the screen that sent them, so only money received and security notices do.
  useEffect(() => {
    const list = inbox.data?.notifications;
    if (!list) return;
    if (seen.current === null) { seen.current = new Set(list.map((item) => item.id)); return; }
    for (const item of [...list].reverse()) {
      if (seen.current.has(item.id)) continue;
      seen.current.add(item.id);
      if (!item.read && (item.kind === "received" || item.kind === "security")) toast.show({ tone: item.kind === "security" ? "info" : "success", title: item.title, detail: item.body });
    }
    // A notice about money moving means balances and history changed.
    if (list.some((item) => !item.read && item.kind !== "security")) void client.invalidateQueries({ predicate: (query) => query.queryKey[0] !== "notifications" });
  }, [inbox.data, toast, client]);

  if (!user) return null;
  const unread = inbox.data?.unread ?? 0;
  async function toggle() {
    setOpen(!open);
    if (!open && unread) {
      await api("/api/notifications/read", { method: "POST" }).catch(() => undefined);
      await client.invalidateQueries({ queryKey: ["notifications", user?.id] });
    }
  }
  return <div className="notificationBell">
    <button className="iconButton" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => void toggle()}>
      <Bell size={17} />{unread > 0 && <span className="notificationCount" data-testid="notification-count">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <section className="notificationPanel" role="dialog" aria-label="Notifications">
      <h2>Notifications</h2>
      {inbox.data?.notifications.length ? <ul>{inbox.data.notifications.map((item) => <li key={item.id} className={item.read ? "" : "unread"}>
        <Link href={item.link ?? "/app"} onClick={() => setOpen(false)}><strong>{item.title}</strong><small>{item.body}</small>
          <time>{new Date(item.createdAt).toLocaleString()}</time></Link></li>)}</ul>
        : <p className="sourceCaption">Nothing yet. Money you receive, transactions you make, and security changes show up here.</p>}
      <Link className="sourceCaption" href="/app/settings#notifications" onClick={() => setOpen(false)}>Notification settings</Link>
    </section>}
  </div>;
}
