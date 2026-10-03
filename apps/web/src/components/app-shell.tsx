"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine, ArrowDownUp, ArrowUpFromLine, CandlestickChart, ChartNoAxesColumn, CircleHelp, CreditCard,
  LayoutGrid, List, LogIn, CirclePercent, Settings, TrendingUp, type LucideIcon
} from "lucide-react";
import { useEffect, useState } from "react";
import { navigation } from "@/lib/product-map";
import { AccountDetails, AccountMenu } from "./account-menu";
import { AccountClosedGate } from "./account-closed";
import { AppBrand } from "./brand";
import { CommandMenu } from "./command-menu";
import { NotificationBell } from "./notification-bell";
import { SupportChatProvider } from "./support-chat";
import { ThemeChoice } from "./theme-choice";

/** The twelve sections, in order, not grouped (redesign-journeys.md, Navigation). */
const sections: { label: string; href: string }[] = navigation.flatMap((group) => [...group.items]);
const iconFor: Record<string, LucideIcon> = {
  Overview: LayoutGrid, Deposit: ArrowDownToLine, Send: ArrowUpFromLine, Swap: ArrowDownUp, Earn: TrendingUp, Perps: CandlestickChart, Predictions: CirclePercent,
  Cards: CreditCard, Transactions: List, Insights: ChartNoAxesColumn, Settings, Support: CircleHelp
};

function isCurrent(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop: a sidebar with the eleven sections, and a top bar with search, the bell, and the account menu.
 * Phone: a header with the wordmark and the bell, and a floating menu button that opens the sections as tiles. Every page
 * leaves room at the bottom, so the customer can always scroll a button clear of it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/app";
  return (
    <div className="productShell appFrame">
      {/* The aside runs the page's full height, so its background never stops short; the brand and sections stay in view. */}
      <aside className="appSidebar"><div className="appSidebarInner">
        <AppBrand />
        <nav className="appNav" aria-label="Primary">
          {sections.map((item) => {
            const Icon = iconFor[item.label];
            const current = isCurrent(pathname, item.href);
            return <Link key={item.href} href={item.href} title={item.label} aria-current={current ? "page" : undefined}>
              <Icon aria-hidden="true" /><span className="appNavLabel">{item.label}</span></Link>;
          })}
        </nav>
      </div></aside>
      <div className="appMain">
        <header className="appTopbar">
          <div className="appTopbarStart"><span className="appPhoneOnly"><AppBrand /></span><span className="appDesktopOnly"><CommandMenu /></span></div>
          <div className="appTopbarEnd"><NotificationBell /><AccountMenu /></div>
        </header>
        <main className="appContent"><SupportChatProvider><AccountClosedGate>{children}</AccountClosedGate></SupportChatProvider></main>
      </div>
      <MenuSheet pathname={pathname} />
    </div>
  );
}

/** Phone only: the floating menu button and the sheet of twelve tiles, three per row, with the account at the bottom. */
function MenuSheet({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  // Disabled until hydrated, so an early tap isn't lost.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { authenticated, ready, login } = useAuth();
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button type="button" className="appMenuButton" aria-label="Open menu" disabled={!mounted}><LayoutGrid aria-hidden="true" /></button>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="appScrim" />
        <Dialog.Content className="appSheet">
          <span className="appSheetHandle" aria-hidden="true" />
          <div className="appSheetHead"><Dialog.Title>Menu</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
          <Dialog.Description className="srOnly">Go to a section of Aura.</Dialog.Description>
          <nav className="appTiles" aria-label="Sections">
            {sections.map((item) => {
              const Icon = iconFor[item.label];
              return <Dialog.Close asChild key={item.href}>
                <Link href={item.href} aria-current={isCurrent(pathname, item.href) ? "page" : undefined}><Icon aria-hidden="true" />{item.label}</Link>
              </Dialog.Close>;
            })}
          </nav>
          {authenticated ? <AccountDetails /> : <div className="appAccount">
            <div className="appAccountRow"><span>Theme</span><ThemeChoice /></div>
            <button type="button" className="appButton appButtonPrimary" disabled={!ready} onClick={() => { setOpen(false); login(); }}><LogIn aria-hidden="true" />Create account or sign in</button>
          </div>}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
