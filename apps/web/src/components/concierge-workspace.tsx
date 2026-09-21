"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowUp, Bot, LoaderCircle, ShieldCheck, User } from "lucide-react";
import { useState } from "react";

type Message = { role: "user" | "assistant"; content: string };
const prompts = ["Explain how Aurel keeps control of my wallet with me.", "What are the risks of supplying USDC to Aave?", "Draft a checklist for moving assets without lowering my reserve below target."];

export function ConciergeWorkspace() {
  const { getAccessToken } = usePrivy();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "I can explain your wallet, Aave positions, risk framework, membership, and provider roles. I can draft an action, but I cannot sign or move assets." }]);
  const [working, setWorking] = useState(false);

  async function ask(text = question) {
    if (!text.trim() || working) return;
    setMessages((items) => [...items, { role: "user", content: text.trim() }]); setQuestion(""); setWorking(true);
    try {
      const token = await getAccessToken(); if (!token) throw new Error("Your secure session expired.");
      const response = await fetch("/api/concierge", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ question: text.trim() }) });
      const body = await response.json() as { response?: string; message?: string }; if (!response.ok || !body.response) throw new Error(body.message ?? "The concierge is unavailable.");
      setMessages((items) => [...items, { role: "assistant", content: body.response! }]);
    } catch (error) { setMessages((items) => [...items, { role: "assistant", content: error instanceof Error ? error.message : "The concierge is unavailable." }]); }
    finally { setWorking(false); }
  }

  return <div className="conciergeLayout"><section className="panel conciergePanel"><div className="conciergeHeader"><div><p className="eyebrow">READ-ONLY ADVISORY INTERFACE</p><h2>Aurel Concierge</h2></div><span><ShieldCheck size={14} /> Cannot transact</span></div><div className="conversation" aria-live="polite">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span>{message.role === "assistant" ? <Bot size={15} /> : <User size={15} />}</span><p>{message.content}</p></div>)}{working && <div className="message assistant"><span><LoaderCircle className="spin" size={15} /></span><p>Reviewing approved product guidance…</p></div>}</div><form className="conciergeComposer" onSubmit={(event) => { event.preventDefault(); void ask(); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about your wallet, a protocol, or why an action is blocked…" maxLength={1200} /><button aria-label="Send" disabled={working || !question.trim()}><ArrowUp size={17} /></button></form></section><aside className="panel conciergePrompts"><p className="eyebrow">USEFUL QUESTIONS</p>{prompts.map((prompt) => <button key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}<div className="modalRisk">Responses are educational product guidance, not investment, legal, or tax advice. Financial facts must come from the displayed provider or chain source.</div></aside></div>;
}

