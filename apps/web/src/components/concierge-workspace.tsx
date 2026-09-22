"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Bot, CalendarDays, LoaderCircle, Plane, Send, Utensils, User, X } from "lucide-react";
import { useState } from "react";
import { SupportCasePanel } from "./support-case-panel";

type Message = { role: "user" | "assistant"; content: string };
const prompts = ["How do I add money?", "Explain my transfer controls.", "What benefits come with my membership?"];

export function ConciergeWorkspace() {
  const { getAccessToken } = usePrivy();
  const [question, setQuestion] = useState("");
  const [messages, setMessages] = useState<Message[]>([{ role: "assistant", content: "How can I help?" }]);
  const [working, setWorking] = useState(false);
  const [requestType, setRequestType] = useState<string | null>(null);
  const [requestSent, setRequestSent] = useState(false);

  async function ask(text = question) {
    if (!text.trim() || working) return;
    setMessages((items) => [...items, { role: "user", content: text.trim() }]); setQuestion(""); setWorking(true);
    try {
      const token = await getAccessToken(); if (!token) throw new Error("Please sign in again.");
      const response = await fetch("/api/concierge", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ question: text.trim() }) });
      const body = await response.json() as { response?: string; message?: string }; if (!response.ok || !body.response) throw new Error(body.message ?? "Concierge is unavailable.");
      setMessages((items) => [...items, { role: "assistant", content: body.response! }]);
    } catch (error) { setMessages((items) => [...items, { role: "assistant", content: error instanceof Error ? error.message : "Concierge is unavailable." }]); }
    finally { setWorking(false); }
  }

  function openRequest(type: string) { setRequestType(type); setRequestSent(false); }

  return <>
    <section className="conciergeServices"><button className="panel" onClick={() => openRequest("Travel Planning")}><Plane size={19} /><strong>Travel Planning</strong><small>Flights, stays, and itineraries</small></button><button className="panel" onClick={() => openRequest("Dining")}><Utensils size={19} /><strong>Dining</strong><small>Reservations and recommendations</small></button><button className="panel" onClick={() => openRequest("Events")}><CalendarDays size={19} /><strong>Events</strong><small>Tickets and experiences</small></button></section>
    <div className="conciergeLayout"><section className="panel conciergePanel"><div className="conciergeHeader"><div><h2>Account Assistant</h2></div></div><div className="conversation" aria-live="polite">{messages.map((message, index) => <div className={`message ${message.role}`} key={index}><span>{message.role === "assistant" ? <Bot size={15} /> : <User size={15} />}</span><p>{message.content}</p></div>)}{working && <div className="message assistant"><span><LoaderCircle className="spin" size={15} /></span><p>One moment…</p></div>}</div><form className="conciergeComposer" onSubmit={(event) => { event.preventDefault(); void ask(); }}><textarea value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask Aurel…" maxLength={1200} /><button aria-label="Send" disabled={working || !question.trim()}><Send size={17} /></button></form></section><aside className="panel conciergePrompts"><h3>Popular Questions</h3>{prompts.map((prompt) => <button key={prompt} onClick={() => void ask(prompt)}>{prompt}</button>)}</aside></div>
    <SupportCasePanel />
    {requestType && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setRequestType(null)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="request-title"><button className="modalClose" onClick={() => setRequestType(null)} aria-label="Close"><X size={18} /></button><h2 id="request-title">{requestType}</h2>{requestSent ? <div className="setupPrompt"><span><CalendarDays size={21} /></span><h3>Complete Concierge Setup</h3><p>Activate your membership to send this request.</p><button className="button primary full">Continue Setup</button></div> : <form onSubmit={(event) => { event.preventDefault(); setRequestSent(true); }}><label className="fieldLabel">What Can We Arrange?<textarea className="requestTextarea" placeholder="Dates, location, preferences, and anything else we should know" required /></label><label className="fieldLabel">Preferred Contact<select><option>In-app message</option><option>Email</option><option>Phone</option></select></label><button className="button primary full">Review Request</button></form>}</section></div>}
  </>;
}
