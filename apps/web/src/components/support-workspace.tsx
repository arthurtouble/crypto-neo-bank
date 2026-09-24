"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useState } from "react";
import { SupportCasePanel } from "./support-case-panel";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const questions = ["How do I receive crypto?", "How do transfer limits work?", "What is available now?"];

type Message = { role: "assistant" | "user"; text: string };

export function SupportWorkspace() {
  const { getAccessToken } = usePrivy();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([]);
  const [busy, setBusy] = useState(false);
  async function ask(value = question) {
    if (busy || !value.trim()) return;
    setMessages((items) => [...items, { role: "user", text: value.trim() }]); setQuestion(""); setBusy(true);
    try {
      const token = await getAccessToken();
      if (!token) throw new Error("Sign in again to ask the assistant.");
      const response = await fetch("/api/support/assistant", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ question: value.trim() }) });
      const body = await response.json() as { response?: string };
      if (!response.ok || !body.response) throw new Error("The assistant is unavailable. You can still contact support below.");
      setMessages((items) => [...items, { role: "assistant", text: body.response! }]);
    } catch (error) { setMessages((items) => [...items, { role: "assistant", text: error instanceof Error ? error.message : "The assistant is unavailable." }]); }
    finally { setBusy(false); }
  }
  return <div className="moneySimple">
    <section className="panel settingsPanel"><h2>Assistant</h2><p>Ask about Aura features and account controls. For account-specific problems, contact support.</p><div className="supportMessages" aria-live="polite">{messages.map((item, index) => <p key={index}><strong>{item.role === "user" ? "You" : "Aura"}</strong> {item.text}</p>)}</div><div className="supportPrompts">{questions.map((item) => <button className="button secondary" key={item} disabled={busy} onClick={() => void ask(item)}>{item}</button>)}</div><form onSubmit={(event) => { event.preventDefault(); void ask(); }}><label className="fieldLabel">Your question<input value={question} onChange={(event) => setQuestion(event.target.value)} maxLength={1200} /></label><button className="button primary" disabled={busy || question.trim().length < 2}>{busy ? "Thinking…" : "Ask"}</button></form></section>
    <SupportCasePanel />
    <section className="panel settingsPanel"><h2>Docs and FAQs</h2><p>Read about setup, safety, and current availability.</p><div className="supportDocs"><a href={`${docs}/getting-started/status/`}>Product status</a><a href={`${docs}/safety/account-controls/`}>Account controls</a><a href={`${docs}/getting-started/setup/`}>Getting started</a></div></section>
  </div>;
}
