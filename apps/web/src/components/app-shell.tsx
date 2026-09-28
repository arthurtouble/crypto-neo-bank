"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Menu, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Brand } from "./brand";
import { icons } from "./icons";
import { navigation } from "@/lib/product-map";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";
import { PrivyAccountButton } from "./privy-account-button";
import { ClientIdentity } from "./client-identity";
import { AccountClosedGate } from "./account-closed";
import { NotificationBell } from "./notification-bell";
import { SupportChatProvider } from "./support-chat";

const iconByPage: Record<string, typeof icons.dashboard> = {
  Overview: icons.dashboard, Deposit: icons.received, Send: icons.sent,
  Swap: icons.activity, Earn: icons.earn, Borrow: icons.money,
  Cards: icons.card, Rewards: icons.benefits,
  Transactions: icons.activity, Insights: icons.earn, Settings: icons.settings,
  Support: icons.security
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  return (
    <div className="productShell">
      <aside className={`sidebar ${open ? "isOpen" : ""}`}>
        <div className="sidebarTop">
          <Brand compact />
          <button className="mobileClose" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <div className="environmentLabel"><span /> Aura</div>
        <nav className="sideNav groupedNav" aria-label="Primary">
          {navigation.map((group) => <div className="navGroup" key={group.group}><p>{group.group}</p>{group.items.map((item) => {
            const Icon = iconByPage[item.label];
            const active = pathname === item.href;
            return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}</div>)}
        </nav>
        <div className="sidebarFooter">
          <ClientIdentity />
        </div>
      </aside>
      {open && <button className="navScrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="productMain">
        <header className="productHeader">
          <button className="menuButton" onClick={() => setOpen(true)} aria-label="Open navigation" disabled={!mounted}><Menu size={20} /></button>
          <CommandMenu />
          <div className="headerRight"><span className="networkStatus"><i /> Secure Connection</span><NotificationBell /><ThemeToggle /><PrivyAccountButton /></div>
        </header>
        <main className="productContent"><SupportChatProvider><AccountClosedGate>{children}</AccountClosedGate></SupportChatProvider></main>
      </div>
    </div>
  );
}
