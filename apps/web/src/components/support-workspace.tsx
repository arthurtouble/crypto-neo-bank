"use client";

import { useAuth } from "@/lib/client/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { LoaderCircle, MessageCircle } from "lucide-react";
import { GuestBanner } from "./guest-banner";
import { SettingRow } from "./setting-row";
import { useSupportChat } from "./support-chat";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

/**
 * Support (journey J17): chat (Intercom's Messenger, where Fin answers first and the team takes over), help articles
 * on the docs site, and the problems that need acting on straight away. Locking and unlocking the account live in
 * Settings. Card disputes start from the card payment itself.
 */
export function SupportWorkspace() {
  const { ready, authenticated, login } = useAuth();
  const isExample = ready && !authenticated;
  const chat = useSupportChat();
  const closing = useSearchParams().get("topic") === "close-account";
  const chatReady = chat.status === "ready";

  // Guests read the articles; chat is for signed-in customers, so its buttons sign in first.
  const chatButton = (label: string, message?: string, primary = false) => isExample
    ? <button type="button" className={`appButton${primary ? " appButtonPrimary" : ""}`} onClick={login}>{label}</button>
    : <button type="button" className={`appButton${primary ? " appButtonPrimary" : ""}`} disabled={!chatReady} onClick={() => chat.open(message)}>
      {chat.status === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : primary ? <MessageCircle aria-hidden="true" /> : null} {label}</button>;

  return <div className="mxPage stPage suPage">
    {(isExample || !ready) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="stHead"><h1>Support</h1></header>
    <section className="mxCard stCard" aria-labelledby="help-heading"><h2 id="help-heading">Get help</h2>
      <ul className="stRows">
        {closing && <li><SettingRow title="Close your account" detail="Move your money out first. We close accounts with no funds left, and keep the records the law requires.">
          {chatButton("Ask to close", "Please close my Aura account. I've moved all my money out.", true)}</SettingRow></li>}
        <li><SettingRow title="Chat with us" detail={!isExample && chat.status === "unavailable" ? "Chat isn't available right now. Try again later."
          : "Aura's assistant answers straight away, and our team takes over when it can't help. Never share a seed phrase, private key, or one-time code."}>
          {chatButton(isExample ? "Sign in to chat" : "Chat", undefined, !closing)}</SettingRow></li>
        <li><SettingRow title="Help articles" detail="Getting started, account controls, and what's available now.">
          <a className="appButton" href={`${docs}/getting-started/setup/`}>Open</a></SettingRow></li>
      </ul>
    </section>
    <section className="mxCard stCard" aria-labelledby="report-heading"><h2 id="report-heading">Report a problem</h2>
      <ul className="stRows">
        <li><SettingRow title="Someone else may be using my account" detail="Turn on the emergency lock in Settings first, so nothing can be sent. Then tell us what happened.">
          <span className="mxActions"><Link className="appButton" href="/app/settings#emergency-lock">Lock in Settings</Link>
            {chatButton("Tell us", "Someone else may be using my Aura account.")}</span></SettingRow></li>
        <li><SettingRow title="I sent money to a scam or the wrong address" detail="Blockchain transfers can't be reversed by Aura or anyone else. Tell us what happened and which transaction, and we'll help you report it.">
          {chatButton("Tell us", "I sent money to a scam or the wrong address. The transaction was: ")}</SettingRow></li>
      </ul>
    </section>
  </div>;
}
