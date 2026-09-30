"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle } from "lucide-react";
import { useState, type FormEvent } from "react";
import { useApi } from "@/lib/client/api";
import { bankStage, useBankAccount } from "@/lib/client/use-bank-account";
import { bankRailNames as railNames } from "@/lib/format/bank";
import { CopyButton } from "./copy-button";
import { useToast } from "./toast";

function CopyValue({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd className="mxCopy"><span className="mxMono">{value}</span>
    <CopyButton value={value} ariaLabel={`Copy ${label.toLowerCase()}`} className="appButton mxCopyButton" /></dd></div>;
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

  return <form className="mxForm" onSubmit={(event) => void submit(event)}>
    <p className="mxHint">Bridge, our banking partner, verifies your identity before it opens a USD account for you.</p>
    <label className="mxField">Full legal name<input value={fullName} onChange={(event) => setFullName(event.target.value)} autoComplete="name" required minLength={2} maxLength={120} /></label>
    <label className="mxField">Email<input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="email" required maxLength={254} /></label>
    <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={busy || fullName.trim().length < 2 || !email}>{busy ? "Starting…" : "Verify with Bridge"}</button>
  </form>;
}

/** Deposit from a bank: Bridge setup, then the customer's USD deposit details. */
export function BankDepositPanel() {
  const account = useBankAccount();
  const stage = account.data ? bankStage(account.data) : null;
  const instructions = account.data?.account.depositInstructions;
  const nextAction = account.data?.nextAction;

  const steps = [
    { label: "Verify with Bridge", done: stage === "reviewing" || stage === "active", current: stage === "start" || stage === "continue" },
    { label: "Bridge reviews your details", done: stage === "active", current: stage === "reviewing" },
    { label: "Get your US bank details", done: stage === "active", current: false }
  ];
  return <section className="mxPanel" aria-labelledby="deposit-bank">
    <div className="mxPanelHead"><h2 id="deposit-bank">Deposit from a bank</h2>
      {stage === "unavailable" ? <span className="mxBadge">Coming soon</span> : <span className="mxHint">Bank transfer · Bridge</span>}</div>
    {account.isPending && <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading your bank details…</div>}
    {account.isError && <p className="mxNote mxNoteError" role="alert">Bank details are unavailable right now. <button type="button" className="appTextButton" onClick={() => void account.refetch()}>Try again</button></p>}
    {stage === "unavailable" && <p className="mxHint">Coming soon. You&apos;ll get US bank details and deposits will arrive as USDC in your Aura account.</p>}
    {stage && stage !== "unavailable" && stage !== "rejected" && stage !== "active" && <ol className="mxChecklist" aria-label="Bank setup">
      {steps.map((step) => <li key={step.label} className={step.done ? "isDone" : step.current ? "isCurrent" : undefined}>{step.label}</li>)}
    </ol>}
    {stage === "start" && <VerificationForm onStarted={() => void account.refetch()} />}
    {stage === "continue" && nextAction?.type === "continue_verification" && <>
      <p className="mxHint">Finish identity verification with Bridge. After you finish, it can take a few minutes to confirm.</p>
      <div className="mxActions">
        <a className="appButton appButtonPrimary" href={nextAction.url} target="_blank" rel="noreferrer">Continue verification</a>
        <button type="button" className="appButton" disabled={account.isFetching} onClick={() => void account.refetch()}>{account.isFetching ? "Checking…" : "Check status"}</button>
      </div>
    </>}
    {stage === "reviewing" && <>
      <p className="mxHint">Bridge is reviewing your details. This can take a few minutes.</p>
      <div className="mxActions"><button type="button" className="appButton" disabled={account.isFetching} onClick={() => void account.refetch()}>{account.isFetching ? "Checking…" : "Check status"}</button></div>
    </>}
    {stage === "rejected" && <p className="mxNote mxNoteError">Bridge couldn&apos;t verify your identity. Contact support.</p>}
    {stage === "active" && instructions && <>
      <p className="mxHint">Send USD from your bank to these details. Deposits arrive as USDC in your Aura account.</p>
      <dl className="mxSummary">
        <div><dt>Bank</dt><dd>{instructions.bankName}</dd></div>
        <div><dt>Beneficiary</dt><dd>{instructions.beneficiaryName}</dd></div>
        <CopyValue label="Account number" value={instructions.accountNumber} />
        <CopyValue label="Routing number" value={instructions.routingNumber} />
        <div><dt>Accepted</dt><dd>{instructions.rails.map((rail) => railNames[rail]).join(", ")}</dd></div>
      </dl>
    </>}
  </section>;
}
