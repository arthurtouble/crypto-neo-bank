"use client";

import { useAuth } from "@/lib/client/auth";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ExternalLink, LoaderCircle, MessageCircle, RotateCw } from "lucide-react";
import { useAccountClosed } from "./account-closed";
import { GuestBanner } from "./guest-banner";
import { SettingRow } from "./setting-row";
import { useSupportChat } from "./support-chat";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

/**
 * Support (journey J17): chat (Intercom's Messenger, where Fin answers first and the team takes over), help articles
 * on the docs site, and the problems that need acting on straight away. Locking and unlocking the account live in
 * Settings. Card disputes start from the card payment itself. When chat can't load, the chat row offers Try again and
 * the report rows say why their button is off. A closed account sees only what it can still use: chat and articles.
 */
export function SupportWorkspace() {
  const { ready, authenticated, login } = useAuth();
  const isExample = ready && !authenticated;
  const chat = useSupportChat();
  const closed = useAccountClosed();
  const closing = useSearchParams().get("topic") === "close-account" && !closed;
  const chatReady = chat.status === "ready";
  const chatDown = !isExample && chat.status === "unavailable";

  // Guests read the articles; chat is for signed-in customers, so its buttons sign in first. The banner's
  // "Create account or sign in" stays the only primary button for guests.
  const chatButton = (label: string, message?: string, primary = false) => isExample
    ? <button type="button" className="appButton" onClick={login}>{label}</button>
    : <button type="button" className={`appButton${primary ? " appButtonPrimary" : ""}`} disabled={!chatReady} onClick={() => chat.open(message)}>
      {primary ? chat.status === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <MessageCircle aria-hidden="true" /> : null} {label}</button>;

  return <div className="mxPage stPage suPage">
    {(isExample || !ready) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="stHead"><h1>Support</h1>
      {closed && <p className="mxHint">Your account is closed. Chat with us if you think this is a mistake.</p>}</header>
    <section className="mxCard stCard" aria-labelledby="help-heading"><h2 id="help-heading">Get help</h2>
      <ul className="stRows">
        {closing && <li><SettingRow title="Close your account" detail={`Move your money out first. We close accounts with no funds left, and keep the records the law requires.${chatDown ? " Chat is unavailable right now." : ""}`}>
          {chatButton("Ask to close", "I'd like to close my Aura account. I've moved all my money out.", true)}</SettingRow></li>}
        <li><SettingRow title="Chat with us" detail={chatDown ? "Chat can't be loaded right now. Try again, or read the help articles."
          : <>Our assistant answers first, and our team takes over if needed.<br />Never share a seed phrase, private key, or one-time code.</>}>
          {chatDown ? <button type="button" className={`appButton${closing ? "" : " appButtonPrimary"}`} onClick={chat.retry}><RotateCw aria-hidden="true" /> Try again</button>
            : chatButton("Chat", undefined, !closing)}</SettingRow></li>
        <li><SettingRow title="Help articles" detail="Guides to using Aura, on our help site.">
          <a className="appButton" href={`${docs}/`} target="_blank" rel="noreferrer">Open <ExternalLink aria-hidden="true" /></a></SettingRow></li>
      </ul>
    </section>
    <section className="mxCard stCard" aria-labelledby="report-heading"><h2 id="report-heading">Report a problem</h2>
      <ul className="stRows">
        {/* A closed account can't open Settings (every page but Support shows the closed screen), so it's only told to chat. */}
        <li><SettingRow title="Someone else may be using my account" detail={`${closed ? "Tell us what happened." : "Turn on the emergency lock in Settings first, so nothing can be sent. Then tell us what happened."}${chatDown ? " Chat is unavailable right now." : ""}`}>
          <span className="mxActions">{!closed && <Link className="appButton" href="/app/settings#emergency-lock">Lock in Settings</Link>}
            {chatButton("Tell us", "Someone else may be using my Aura account.")}</span></SettingRow></li>
        <li><SettingRow title="I sent money to a scam or the wrong address" detail={`Crypto transfers can't be reversed by Aura or anyone else. Tell us what happened and which transaction, and we'll help you report it.${chatDown ? " Chat is unavailable right now." : ""}`}>
          {chatButton("Tell us", "I sent money to a scam or the wrong address. The transaction was: ")}</SettingRow></li>
      </ul>
    </section>
  </div>;
}
