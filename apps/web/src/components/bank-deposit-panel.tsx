"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Check, Copy } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useApi } from "@/lib/client/api";
import { bankStage, useBankAccount } from "@/lib/client/use-bank-account";
import { useToast } from "./toast";

const railNames = { ach: "Bank transfer", wire: "Wire", fednow: "Instant transfer" } as const;

function CopyValue({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard access can be refused; the number stays visible to copy by hand. */ }
  }
  return <span>{label}<span style={{ display: "flex", alignItems: "center", gap: 8 }}><strong>{value}</strong>
    <button type="button" className="button secondary" style={{ minHeight: 30, padding: "0 10px" }} onClick={() => void copy()} aria-label={`Copy ${label.toLowerCase()}`}>
      {copied ? <Check size={13} /> : <Copy size={13} />}{copied ? "Copied" : "Copy"}
    </button></span></span>;
}

function VerificationForm({ onStarted }: { onStarted: () => void }) {
  const { user } = usePrivy();
  const api = useApi();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState(user?.email?.address ?? "");
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    // Open the tab during the click so the browser doesn't block it; point it at Bridge once the link exists.
    const tab = window.open("", "_blank");
    try {
      const result = await api<{ verificationUrl: string; termsUrl: string }>("/api/money/onboarding", { method: "POST", json: { fullName: fullName.trim(), email: email.trim() } });
      if (tab) { tab.opener = null; tab.location.href = result.verificationUrl; }
      onStarted();
    } catch (reason) {
      tab?.close();
      toast.error("Verification didn't start", reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    } finally { setBusy(false); }
  }

  return <form onSubmit={(event) => void submit(event)}>
    <p>Bridge, our banking partner, verifies your identity before it opens a USD account for you.</p>
    <label className="fieldLabel">Full legal name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} /></label>
    <label className="fieldLabel">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} /></label>
    <button className="button primary" style={{ marginTop: 14 }} disabled={busy || fullName.trim().length < 2 || !email}>{busy ? "Starting…" : "Verify with Bridge"}</button>
  </form>;
}

/** Deposit from a bank: Bridge setup, then the customer's USD deposit details. */
export function BankDepositPanel() {
  const account = useBankAccount();
  const stage = account.data ? bankStage(account.data) : null;
  const instructions = account.data?.account.depositInstructions;
  const nextAction = account.data?.nextAction;

  return <section className="panel exampleCard"><span className="exampleLabel">Bank transfer · Bridge</span><h2>Deposit from a bank</h2>
    {account.isPending && <p role="status">Loading your bank details…</p>}
    {account.isError && <p className="formError" role="alert">Bank details are unavailable right now. <button type="button" className="textLink" onClick={() => void account.refetch()}>Try again</button></p>}
    {stage === "unavailable" && <p>Bank deposits open once Aura&apos;s banking partner is connected.</p>}
    {stage === "start" && <VerificationForm onStarted={() => void account.refetch()} />}
    {stage === "continue" && nextAction?.type === "continue_verification" && <>
      <p>Finish identity verification with Bridge. After you finish, it can take a few minutes to confirm.</p>
      <a className="button primary" href={nextAction.url} target="_blank" rel="noreferrer">Continue verification</a>
      <button type="button" className="button secondary" style={{ marginLeft: 8 }} disabled={account.isFetching} onClick={() => void account.refetch()}>{account.isFetching ? "Checking…" : "Check status"}</button>
    </>}
    {stage === "reviewing" && <>
      <p>Bridge is reviewing your details. This can take a few minutes.</p>
      <button type="button" className="button secondary" disabled={account.isFetching} onClick={() => void account.refetch()}>{account.isFetching ? "Checking…" : "Check status"}</button>
    </>}
    {stage === "rejected" && <p>Bridge couldn&apos;t verify your identity. Contact Support.</p>}
    {stage === "active" && instructions && <>
      <p>Send USD from your bank to these details. Deposits arrive as USDC in your Aura account.</p>
      <div className="bankDetails">
        <span>Bank<strong>{instructions.bankName}</strong></span>
        <span>Beneficiary<strong>{instructions.beneficiaryName}</strong></span>
        <CopyValue label="Account number" value={instructions.accountNumber} />
        <CopyValue label="Routing number" value={instructions.routingNumber} />
        <span>Accepted<strong>{instructions.rails.map((rail) => railNames[rail]).join(", ")}</strong></span>
      </div>
    </>}
  </section>;
}
