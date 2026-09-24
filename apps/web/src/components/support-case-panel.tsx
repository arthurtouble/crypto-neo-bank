"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Check, LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TurnstileField } from "./turnstile-field";

export function SupportCasePanel() {
  const topic = useSearchParams().get("topic");
  const { getAccessToken } = usePrivy();
  const [category, setCategory] = useState("transaction");
  const [summary, setSummary] = useState("");
  const [urgent, setUrgent] = useState(false);
  const [working, setWorking] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setWorking(true); setResult(null);
    try {
      const turnstileToken = String(new FormData(event.currentTarget as HTMLFormElement).get("turnstileToken") ?? "") || undefined;
      const token = await getAccessToken();
      const response = await fetch("/api/support/cases", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ category, priority: urgent ? "urgent" : "normal", summary, turnstileToken }) });
      const body = await response.json() as { caseId?: string; message?: string };
      if (!response.ok || !body.caseId) throw new Error(body.message ?? "Your request could not be opened.");
      setSummary(""); setResult(`Case ${body.caseId.slice(0, 8)} opened. Keep this reference.`);
    } catch (error) { setResult(error instanceof Error ? error.message : "Your request could not be opened."); }
    finally { setWorking(false); setTurnstileResetKey((value) => value + 1); }
  }
  return <section className="panel supportCasePanel"><p className="eyebrow">HUMAN SUPPORT</p><h3>{topic === "card-charge" ? "Question about a card charge?" : "Something needs investigation?"}</h3><p>Open a traceable case. Never include a seed phrase, private key, password, or one-time code. Card disputes are routed to the issuer only after an issuer case integration is connected.</p><form onSubmit={(event) => void submit(event)}><div><label className="fieldLabel">Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="transaction">Transaction</option><option value="account">Account</option><option value="security">Security</option><option value="product">Product</option><option value="other">Other</option></select></label><label className="supportUrgent"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /> Funds at risk or account security issue</label></div><label className="fieldLabel">What happened?<textarea minLength={10} maxLength={1000} required value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={topic === "card-charge" ? "Describe the card charge, date, amount, and card ending. Do not include the full card number." : "Include the transaction hash or intent reference if available."} /></label><div className="supportSubmit"><TurnstileField action="support_case" resetKey={turnstileResetKey} /><button className="button primary" disabled={working || summary.trim().length < 10}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} Open support case</button></div></form>{result && <div className="securityMessage" role="status"><Check size={14} /> {result}</div>}</section>;
}
