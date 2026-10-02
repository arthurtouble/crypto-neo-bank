"use client";

import { useAuth, type AuthUser } from "@/lib/client/auth";
import { LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { accountEmail } from "@/lib/client/account-email";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { shortAddress } from "@/lib/format";
import { ThemeChoice } from "./theme-choice";

/** Close a popover on Escape or a click outside it, and hand focus back to its button on Escape. */
export function useDismiss(open: boolean, close: () => void, root: RefObject<HTMLElement | null>, trigger?: RefObject<HTMLElement | null>) {
  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => { if (root.current && !root.current.contains(event.target as Node)) close(); };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") { close(); trigger?.current?.focus(); } };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("pointerdown", onPointer); document.removeEventListener("keydown", onKey); };
  }, [open, close, root, trigger]);
}

function accountLabel(user: AuthUser | null) {
  return accountEmail(user)?.address ?? (user?.telegram?.username ? `@${user.telegram.username}` : null) ?? "Aura account";
}

function initial(value: string) {
  return value.match(/[a-z0-9]/i)?.[0]?.toUpperCase() ?? "A";
}

const walletText = (address?: string) => address ? shortAddress(address) : "Wallet preparing";

/** Who is signed in, the theme, and Log out. Shared by the desktop account menu and the phone menu sheet. */
export function AccountDetails() {
  const { user, logout } = useAuth();
  const { address } = useAuraWallet();
  return <div className="appAccount">
    <div className="appAccountWho"><strong>{accountLabel(user)}</strong><span className="appMono">{walletText(address)}</span></div>
    <div className="appAccountRow"><span>Theme</span><ThemeChoice /></div>
    <button type="button" className="appButton" aria-label="Log out of Aura" onClick={() => void logout()}><LogOut aria-hidden="true" />Log out</button>
  </div>;
}

/** Top bar, right, for customers: an avatar that opens the account menu (desktop only). Guests sign in from the example-data banner. */
export function AccountMenu() {
  const { authenticated, user } = useAuth();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);

  if (!authenticated) return null;
  return <div className="appAccountMenu" ref={root}>
    <button ref={button} type="button" className="appAvatar" aria-label="Account" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      {initial(accountLabel(user))}</button>
    {open && <div className="appPopover" role="dialog" aria-label="Account"><AccountDetails /></div>}
  </div>;
}
