"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useApi } from "@/lib/client/api";
import { formatDateTime, formatShortDateTime } from "@/lib/format";
import type { NotificationView } from "@/lib/notifications/store";
import { useDismiss } from "./account-menu";
import { useToast } from "./toast";

type Inbox = { notifications: NotificationView[]; unread: number };

/**
 * The bell in the header: unread notices, a list of the latest (a popover on
 * desktop, a full screen on the phone), and a toast
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
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);
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
  return <div className="appBell" ref={root}>
    <button ref={button} type="button" className="appIconButton" aria-label={unread ? `Notifications, ${unread} unread` : "Notifications"} aria-expanded={open} onClick={() => void toggle()}>
      <Bell aria-hidden="true" />{unread > 0 && <span className="appBellCount" data-testid="notification-count">{unread > 9 ? "9+" : unread}</span>}
    </button>
    {open && <section className="appPopover appInbox" role="dialog" aria-label="Notifications">
      <div className="appInboxHead">
        <button type="button" className="appIconButton appInboxBack" aria-label="Close notifications" onClick={() => { close(); button.current?.focus(); }}><ArrowLeft aria-hidden="true" /></button>
        <h2>Notifications</h2>
      </div>
      {inbox.data?.notifications.length ? <ul>{inbox.data.notifications.map((item) => <li key={item.id} className={item.read ? "" : "unread"}>
        <Link href={item.link ?? "/app"} onClick={close}><strong>{item.title}</strong><span>{item.body}</span>
          <time dateTime={item.createdAt} title={formatDateTime(item.createdAt)}>{formatShortDateTime(item.createdAt)}</time></Link></li>)}</ul>
        : inbox.isError ? <p className="appInboxEmpty appInboxError" role="alert" data-testid="notifications-unavailable">Notifications are unavailable right now.{" "}
          <button type="button" className="appTextButton appInlineButton" onClick={() => void inbox.refetch()}>Try again</button></p>
          : inbox.isPending ? <p className="appInboxEmpty" role="status">Loading notifications</p>
            : <p className="appInboxEmpty">Nothing yet. Money you receive, transactions you make, and security changes show up here.</p>}
      <Link className="appInboxSettings" href="/app/settings#notifications" onClick={close}>Notification settings</Link>
    </section>}
  </div>;
}
