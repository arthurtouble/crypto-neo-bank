"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ArrowDownToLine, ArrowDownUp, ArrowUpFromLine, ChartNoAxesColumn, CircleHelp, CreditCard,
  LayoutGrid, List, LogIn, Settings, TrendingUp, type LucideIcon
} from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import { navigation } from "@/lib/product-map";
import { AccountDetails, AccountMenu } from "./account-menu";
import { AccountClosedGate } from "./account-closed";
import { AppBrand } from "./brand";
import { CommandMenu } from "./command-menu";
import { NotificationBell } from "./notification-bell";
import { SupportChatProvider } from "./support-chat";
import { ThemeChoice } from "./theme-choice";

/** The ten sections, in order, not grouped (redesign-journeys.md, Navigation). */
const sections: { label: string; href: string }[] = navigation.flatMap((group) => [...group.items]);
const iconFor: Record<string, LucideIcon> = {
  Overview: LayoutGrid, Deposit: ArrowDownToLine, Send: ArrowUpFromLine, Swap: ArrowDownUp, Earn: TrendingUp,
  Cards: CreditCard, Transactions: List, Insights: ChartNoAxesColumn, Settings, Support: CircleHelp
};

function isCurrent(pathname: string, href: string) {
  return href === "/app" ? pathname === "/app" : pathname === href || pathname.startsWith(`${href}/`);
}

/**
 * Desktop: a sidebar with the ten sections, and a top bar with search, the bell, and the account menu.
 * Phone: a header with the wordmark and the bell, and a floating menu button that opens the sections as tiles. It steps
 * aside while the page scrolls down or a form is under it.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/app";
  return (
    <div className="productShell appFrame">
      <aside className="appSidebar">
        <AppBrand />
        <nav className="appNav" aria-label="Primary">
          {sections.map((item) => {
            const Icon = iconFor[item.label];
            const current = isCurrent(pathname, item.href);
            return <Link key={item.href} href={item.href} title={item.label} aria-current={current ? "page" : undefined}>
              <Icon aria-hidden="true" /><span className="appNavLabel">{item.label}</span></Link>;
          })}
        </nav>
      </aside>
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

/** Form controls the menu button must never cover: fields, and the buttons inside a form. */
const formControl = "input, select, textarea, form button, [type='submit']";

/**
 * Phone only: whether the floating menu button should step aside. It does while the page scrolls down (as the
 * customer reads on or reaches for a button lower down) and comes back when they scroll up, reach the top, or reach
 * the end, where the page keeps 100px clear. It also steps aside whenever a field or a form's button is under it, so
 * a tap meant for that control reaches it. Checked on scroll, resize, and when the page changes size, once a frame.
 */
function useMenuStepsAside(button: RefObject<HTMLButtonElement | null>) {
  const [aside, setAside] = useState(false);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    let frame = 0;
    let lastY = window.scrollY;
    let down = false;
    const overForm = (el: HTMLElement) => {
      const box = el.getBoundingClientRect();
      const x = box.left + box.width / 2, y = box.top + box.height / 2, r = box.width / 2 - 4;
      const points: Array<[number, number]> = [[x, y], [x - r, y], [x + r, y], [x, y - r], [x, y + r]];
      return points.some(([px, py]) => Boolean(document.elementsFromPoint(px, py).find((item) => !el.contains(item))?.closest(formControl)));
    };
    const check = () => {
      frame = 0;
      const el = button.current;
      if (!el || !phone.matches) { setAside(false); return; }
      const y = window.scrollY;
      const atEdge = y < 40 || y + window.innerHeight >= document.documentElement.scrollHeight - 4;
      if (Math.abs(y - lastY) >= 8) { down = y > lastY; lastY = y; }
      setAside((down && !atEdge) || overForm(el));
    };
    const schedule = () => { if (!frame) frame = requestAnimationFrame(check); };
    const resized = new ResizeObserver(schedule);
    resized.observe(document.body);
    window.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    phone.addEventListener("change", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      resized.disconnect();
      window.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
      phone.removeEventListener("change", schedule);
    };
  }, [button]);
  return aside;
}

/**
 * Phone only: the floating menu button and the sheet of ten tiles, three per row, with the account at the bottom.
 * The button steps aside while the page scrolls down or a form is under it (useMenuStepsAside).
 */
function MenuSheet({ pathname }: { pathname: string }) {
  const [open, setOpen] = useState(false);
  // Disabled until hydrated, so an early tap isn't lost.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const { authenticated, ready, login } = useAuth();
  const button = useRef<HTMLButtonElement>(null);
  const aside = useMenuStepsAside(button);
  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button ref={button} type="button" className="appMenuButton" aria-label="Open menu" disabled={!mounted} data-stepped-aside={aside && !open ? "" : undefined}><LayoutGrid aria-hidden="true" /></button>
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
