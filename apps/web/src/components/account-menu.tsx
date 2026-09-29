"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LogIn, LogOut } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
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

export function accountLabel(user: ReturnType<typeof usePrivy>["user"]) {
  return user?.email?.address ?? user?.google?.email ?? "Aura account";
}

function initials(value: string) {
  return value.split(/\s|@/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "A";
}

export function shortAddress(address?: string) {
  return address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Wallet preparing";
}

/** Who is signed in, the theme, and Log out. Shared by the desktop account menu and the phone menu sheet. */
export function AccountDetails() {
  const { user, logout } = usePrivy();
  const { address } = useAuraWallet();
  return <div className="appAccount">
    <div className="appAccountWho"><strong>{accountLabel(user)}</strong><span className="appMono">{shortAddress(address)}</span></div>
    <div className="appAccountRow"><span>Theme</span><ThemeChoice /></div>
    <button type="button" className="appButton" aria-label="Log out of Aura" onClick={() => void logout()}><LogOut aria-hidden="true" />Log out</button>
  </div>;
}

/** Top bar, right: Sign in for guests; for customers, an avatar that opens the account menu (desktop only). */
export function AccountMenu() {
  const { authenticated, ready, login, user } = usePrivy();
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(open, close, root, button);

  if (!authenticated) return <button type="button" className="appButton appButtonPrimary" disabled={!ready} aria-label="Sign in to Aura" onClick={() => login()}>
    <LogIn aria-hidden="true" />Sign in</button>;
  return <div className="appAccountMenu" ref={root}>
    <button ref={button} type="button" className="appAvatar" aria-label="Account" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen(!open)}>
      {initials(accountLabel(user))}</button>
    {open && <div className="appPopover" role="dialog" aria-label="Account"><AccountDetails /></div>}
  </div>;
}
