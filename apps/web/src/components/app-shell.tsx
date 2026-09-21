"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Beaker, ChevronDown, CircleHelp, Menu, X } from "lucide-react";
import { useState } from "react";
import { Brand } from "./brand";
import { icons } from "./icons";
import { CommandMenu } from "./command-menu";
import { ThemeToggle } from "./theme-toggle";
import { PrivyAccountButton } from "./privy-account-button";

const navigation = [
  { label: "Overview", href: "/app", icon: icons.dashboard },
  { label: "Assets", href: "/app/assets", icon: icons.assets },
  { label: "Earn", href: "/app/earn", icon: icons.earn },
  { label: "Borrow", href: "/app/borrow", icon: icons.earn },
  { label: "Card", href: "/app/card", icon: icons.card },
  { label: "Activity", href: "/app/activity", icon: icons.activity },
  { label: "Benefits", href: "/app/benefits", icon: icons.benefits }
];

const secondary = [
  { label: "Demo lab", href: "/app/sandbox", icon: Beaker },
  { label: "Security", href: "/app/security", icon: icons.security },
  { label: "Settings", href: "/app/settings", icon: icons.settings }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  return (
    <div className="productShell">
      <aside className={`sidebar ${open ? "isOpen" : ""}`}>
        <div className="sidebarTop">
          <Brand compact />
          <button className="mobileClose" onClick={() => setOpen(false)} aria-label="Close navigation"><X size={20} /></button>
        </div>
        <div className="demoPill"><span /> Mainnet read · user-signed</div>
        <nav className="sideNav" aria-label="Primary">
          {navigation.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.href;
            return <Link key={item.href} href={item.href} className={active ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sideRule" />
        <nav className="sideNav secondaryNav" aria-label="Account">
          {secondary.map((item) => {
            const Icon = item.icon;
            return <Link key={item.href} href={item.href} className={pathname === item.href ? "active" : ""} onClick={() => setOpen(false)}><Icon size={18} /><span>{item.label}</span></Link>;
          })}
        </nav>
        <div className="sidebarFooter">
          <Link href="/docs"><CircleHelp size={17} /> Documentation</Link>
          <button><span className="avatar">AM</span><span><strong>Alex Morgan</strong><small>Black member</small></span><ChevronDown size={15} /></button>
        </div>
      </aside>
      {open && <button className="navScrim" aria-label="Close menu" onClick={() => setOpen(false)} />}
      <div className="productMain">
        <header className="productHeader">
          <button className="menuButton" onClick={() => setOpen(true)} aria-label="Open navigation"><Menu size={20} /></button>
          <CommandMenu />
          <div className="headerRight"><span className="networkStatus"><i /> Base mainnet</span><ThemeToggle /><PrivyAccountButton /></div>
        </header>
        <main className="productContent">{children}</main>
      </div>
    </div>
  );
}
