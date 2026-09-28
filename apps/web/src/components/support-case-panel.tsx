"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle, Send } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { TurnstileField } from "./turnstile-field";
import { useToast } from "./toast";

export function SupportCasePanel() {
  const topic = useSearchParams().get("topic");
  const { getAccessToken } = usePrivy();
  const closing = topic === "close-account";
  const [category, setCategory] = useState(closing ? "account" : "transaction");
  const [summary, setSummary] = useState(closing ? "Please close my Aura account. I've moved all my money out." : "");
  const [urgent, setUrgent] = useState(false);
  const [working, setWorking] = useState(false);
  const toast = useToast();
  const [turnstileResetKey, setTurnstileResetKey] = useState(0);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); setWorking(true);
    try {
      const turnstileToken = String(new FormData(event.currentTarget as HTMLFormElement).get("turnstileToken") ?? "") || undefined;
      const token = await getAccessToken();
      const response = await fetch("/api/support/cases", { method: "POST", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ category, priority: urgent ? "urgent" : "normal", summary, turnstileToken }) });
      const body = await response.json() as { caseId?: string; message?: string };
      if (!response.ok || !body.caseId) throw new Error(body.message ?? "Your request could not be opened.");
      setSummary("");
      toast.show({ tone: "success", sticky: true, title: `Case ${body.caseId.slice(0, 8)} opened`, detail: "Keep this reference." });
    } catch (error) { toast.error("Request not opened", error instanceof Error ? error.message : undefined); }
    finally { setWorking(false); setTurnstileResetKey((value) => value + 1); }
  }
  return <section className="panel supportCasePanel"><p className="eyebrow">SUPPORT REQUEST</p><h3>{topic === "card-charge" ? "Question about a card charge?" : closing ? "Close your account" : "Contact support"}</h3><p>Requests are saved in Aura. Replies and issuer disputes need a connected support team. Never include a seed phrase, private key, password, or one-time code.</p><form onSubmit={(event) => void submit(event)}><div><label className="fieldLabel">Category<select value={category} onChange={(event) => setCategory(event.target.value)}><option value="transaction">Transaction</option><option value="account">Account</option><option value="security">Security</option><option value="product">Product</option><option value="other">Other</option></select></label><label className="supportUrgent"><input type="checkbox" checked={urgent} onChange={(event) => setUrgent(event.target.checked)} /> Funds at risk or account security issue</label></div><label className="fieldLabel">What happened?<textarea minLength={10} maxLength={1000} required value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={topic === "card-charge" ? "Describe the card charge, date, amount, and card ending. Do not include the full card number." : "Include the transaction hash or intent reference if available."} /></label><div className="supportSubmit"><TurnstileField action="support_case" resetKey={turnstileResetKey} /><button className="button primary" disabled={working || summary.trim().length < 10}>{working ? <LoaderCircle className="spin" size={14} /> : <Send size={14} />} Open support case</button></div></form></section>;
}
