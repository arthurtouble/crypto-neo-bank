"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Building2, Check, Clock3, Copy, Landmark, LoaderCircle, Send, WalletCards, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { MoneyAccount } from "@/lib/providers/service-catalog";
import { RecipientScheduleWorkspace } from "./recipient-schedule-workspace";
import { BillsWorkspace } from "./bills-workspace";
import { IncomePlanWorkspace } from "./income-plan-workspace";

type Flow = "details" | "deposit" | "withdrawal" | null;
type AccountResponse = { account: MoneyAccount; nextAction: { label: string } };

export function MoneyWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const router = useRouter();
  const [flow, setFlow] = useState<Flow>(null);
  const [rail, setRail] = useState("wire");
  const [amount, setAmount] = useState("");
  const [copied, setCopied] = useState(false);
  const [reviewed, setReviewed] = useState(false);
  const account = useQuery<AccountResponse>({
    queryKey: ["money-account", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/money/account", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Bank transfers are unavailable.");
      return response.json();
    },
    enabled: Boolean(user)
  });
  const active = account.data?.account.state === "active";
  const capabilities = account.data?.account.capabilities ?? [];
  function open(next: Flow) { setFlow(next); setAmount(""); setReviewed(false); }
  function copy(value: string) { void navigator.clipboard.writeText(value); setCopied(true); window.setTimeout(() => setCopied(false), 1200); }

  return <>
    <section className="moneyHero panel"><div><span className="moneyCurrency">USD</span><h2>Bank Transfers</h2><p>Move dollars by bank transfer or wire.</p></div><div className="walletActions"><button className="button secondary" onClick={() => open("details")}><Landmark size={16} /> Account Details</button><button className="button primary" onClick={() => open("withdrawal")}><Send size={16} /> Send Money</button></div></section>
    <div className="moneyGrid">
      <section className="panel transferPanel"><div className="panelHeading"><h2>Add Money</h2></div><div className="transferChoices"><button onClick={() => open("details")}><span><Landmark size={18} /></span><div><strong>Bank Transfer</strong><small>Use your personal account details</small></div><em>{active ? "View" : "Set Up"}</em></button><button onClick={() => open("deposit")}><span><Building2 size={18} /></span><div><strong>Wire Transfer</strong><small>For domestic and international wires</small></div><em>Start</em></button><button onClick={() => router.push("/app/assets")}><span><WalletCards size={18} /></span><div><strong>Digital Assets</strong><small>Add USDC from a wallet</small></div><em>Open</em></button></div></section>
      <section className="panel transferPanel"><div className="panelHeading"><h2>Send Money</h2></div><div className="transferChoices"><button onClick={() => open("withdrawal")}><span><Landmark size={18} /></span><div><strong>To a Bank</strong><small>ACH, wire, or instant transfer</small></div><em>Start</em></button><button onClick={() => router.push("/app/assets")}><span><Send size={18} /></span><div><strong>Digital Assets</strong><small>Send to an address</small></div><em>Open</em></button></div></section>
    </div>
    <section className="panel railsPanel"><div className="panelHeading"><h2>Transfer Options</h2></div>{account.isPending ? <div className="emptyState"><LoaderCircle className="spin" size={17} /> Loading…</div> : <div className="railRows">{capabilities.map((item) => <div key={item.key}><span className={item.state === "available" ? "ready" : "pending"}>{item.state === "available" ? <Check size={13} /> : <Clock3 size={13} />}</span><strong>{item.label}</strong><small>{item.timing}</small><b>{item.state === "available" ? "Available" : "Setup Required"}</b></div>)}</div>}</section>
    <IncomePlanWorkspace bankAccountActive={active} onBankSetup={() => open("details")} />
    <RecipientScheduleWorkspace />
    <BillsWorkspace />
    {flow && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setFlow(null)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="money-modal-title"><button className="modalClose" onClick={() => setFlow(null)} aria-label="Close"><X size={18} /></button>{flow === "details" ? <><h2 id="money-modal-title">Account Details</h2>{active ? <div className="bankDetails"><span>Account Name<strong>{account.data?.account.accountName}</strong></span><span>Routing Number<strong>•••• {account.data?.account.routingNumberLastFour}</strong></span><span>Account Number<strong>•••• {account.data?.account.accountNumberLastFour}</strong></span><button className="button secondary full" onClick={() => copy(`${account.data?.account.routingNumberLastFour} ${account.data?.account.accountNumberLastFour}`)}>{copied ? <Check size={15} /> : <Copy size={15} />}{copied ? "Copied" : "Copy Details"}</button></div> : <div className="setupPrompt"><span><Landmark size={22} /></span><h3>Set Up Bank Transfers</h3><p>Verify your identity to receive personal account details.</p><button className="button primary full">Continue Setup</button></div>}</> : <><h2 id="money-modal-title">{flow === "deposit" ? "Add by Wire" : "Send to a Bank"}</h2><form onSubmit={(event) => { event.preventDefault(); setReviewed(true); }}><label className="fieldLabel">Transfer Type<select value={rail} onChange={(event) => setRail(event.target.value)}><option value="wire">Wire Transfer</option><option value="ach">Bank Transfer</option><option value="fednow">Instant Transfer</option></select></label><label className="fieldLabel">Amount<input inputMode="decimal" placeholder="$0.00" value={amount} onChange={(event) => { setAmount(event.target.value); setReviewed(false); }} /></label>{flow === "withdrawal" && <label className="fieldLabel">Recipient<input placeholder="Choose or add a recipient" /></label>}{reviewed ? <div className="setupPrompt compact"><span><Check size={20} /></span><h3>Ready for Setup</h3><p>Complete identity verification to enable this transfer.</p><button type="button" className="button primary full">Continue Setup</button></div> : <button className="button primary full" disabled={!amount || Number(amount) <= 0}>Review Transfer</button>}</form></>}</section></div>}
  </>;
}
