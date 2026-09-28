"use client";

import { useSearchParams } from "next/navigation";
import { useState } from "react";
import { BookOpen, LoaderCircle, LockKeyhole, MessageCircle, TriangleAlert, UserX } from "lucide-react";
import { useApi } from "@/lib/client/api";
import { useSupportChat } from "./support-chat";
import { useToast } from "./toast";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";

/**
 * Support: chat (Intercom's Messenger, where Fin answers first and the team
 * takes over), help articles on the docs site, and the problems that need
 * acting on straight away. Card disputes arrive with cards, from the card
 * transaction itself.
 */
export function SupportWorkspace() {
  const chat = useSupportChat();
  const api = useApi();
  const toast = useToast();
  const closing = useSearchParams().get("topic") === "close-account";
  const [locking, setLocking] = useState(false);
  const ready = chat.status === "ready";

  async function lockAndReport() {
    setLocking(true);
    try {
      await api("/api/security/policy", { method: "PATCH", json: { accountLocked: true } });
      toast.success("Account locked", "Nothing can be sent until you unlock it with your passkey.");
    } catch {
      toast.error("Account not locked", "Tell us in the chat and we'll help.");
    } finally { setLocking(false); }
    chat.open("Someone else may be using my Aura account. I locked it from Support.");
  }

  const chatButton = (label: string, message?: string) => <button className="button primary" disabled={!ready} onClick={() => chat.open(message)}>
    {chat.status === "loading" ? <LoaderCircle className="spin" size={14} /> : <MessageCircle size={14} />} {label}</button>;

  return <div className="moneySimple">
    <section className="panel settingsPanel" aria-labelledby="help-heading"><h2 id="help-heading">Get help</h2>
      {closing && <div className="settingRow"><span className="settingIcon"><UserX size={17} /></span>
        <div><strong>Close your account</strong><small>Move your money out first. We close accounts with no funds left, and keep the records the law requires.</small></div>
        {chatButton("Ask to close", "Please close my Aura account. I've moved all my money out.")}</div>}
      <div className="settingRow"><span className="settingIcon"><MessageCircle size={17} /></span>
        <div><strong>Chat with us</strong><small>{chat.status === "unavailable" ? "Chat isn't available right now. Try again later." : "Aura's assistant answers straight away, and our team takes over when it can't help. Never share a seed phrase, private key, or one-time code."}</small></div>
        {chatButton("Chat")}</div>
      <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span>
        <div><strong>Help articles</strong><small>Getting started, account controls, and what&apos;s available now.</small></div>
        <a href={`${docs}/getting-started/setup/`}>Open</a></div>
    </section>
    <section className="panel settingsPanel" aria-labelledby="report-heading"><h2 id="report-heading">Report a problem</h2>
      <div className="settingRow"><span className="settingIcon"><LockKeyhole size={17} /></span>
        <div><strong>Someone else may be using my account</strong><small>We lock your account first, so nothing can be sent, then open a chat with our team.</small></div>
        <button className="button secondary" disabled={locking} onClick={() => void lockAndReport()}>{locking ? <LoaderCircle className="spin" size={14} /> : null} Lock and report</button></div>
      <div className="settingRow"><span className="settingIcon"><TriangleAlert size={17} /></span>
        <div><strong>I sent money to a scam or the wrong address</strong><small>Blockchain transfers can&apos;t be reversed by Aura or anyone else. Tell us what happened and which transaction, and we&apos;ll help you report it.</small></div>
        {chatButton("Tell us", "I sent money to a scam or the wrong address. The transaction was: ")}</div>
    </section>
  </div>;
}
