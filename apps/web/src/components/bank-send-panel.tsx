"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { LoaderCircle, Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApi } from "@/lib/client/api";
import { useAction, type ActionView } from "@/lib/client/use-action";
import { bankStage, useBankAccount } from "@/lib/client/use-bank-account";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";

type Recipient = { id: string; kind: "wallet" | "bank"; name: string; detail: string; verified: boolean };

const amountPattern = /^\d{1,9}(\.\d{1,2})?$/;

function lastFour(recipient: Recipient) {
  return /(\d{4})\s*$/.exec(recipient.detail)?.[1] ?? null;
}

function bankLabel(recipient: Recipient) {
  const four = lastFour(recipient);
  return four ? `${recipient.name} •••• ${four}` : recipient.name;
}

const emptyBank = { accountOwnerName: "", bankName: "", accountNumber: "", routingNumber: "", checkingOrSavings: "checking" as "checking" | "savings", streetLine1: "", city: "", state: "", postalCode: "" };

function AddBankAccountForm({ onSaved, onCancel }: { onSaved: (name: string) => void; onCancel: () => void }) {
  const api = useApi();
  const [form, setForm] = useState(emptyBank);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const set = (key: keyof typeof emptyBank) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const valid = form.accountOwnerName.trim() && form.bankName.trim() && /^\d{4,17}$/.test(form.accountNumber) && /^\d{9}$/.test(form.routingNumber)
    && form.streetLine1.trim() && form.city.trim() && /^[A-Za-z]{2}$/.test(form.state) && form.postalCode.trim();

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const result = await api<{ bankAccount: { name: string; lastFour: string } }>("/api/money/bank-accounts", { method: "POST", json: {
        accountOwnerName: form.accountOwnerName.trim(), bankName: form.bankName.trim(), accountNumber: form.accountNumber, routingNumber: form.routingNumber,
        checkingOrSavings: form.checkingOrSavings,
        address: { streetLine1: form.streetLine1.trim(), city: form.city.trim(), state: form.state.toUpperCase(), postalCode: form.postalCode.trim(), country: "USA" }
      } });
      setForm(emptyBank);
      onSaved(`${result.bankAccount.name} •••• ${result.bankAccount.lastFour}`);
    } catch (reason) {
      toast.error("Bank account not saved", reason instanceof Error ? reason.message : "Something went wrong. Try again.");
    } finally { setBusy(false); }
  }

  return <form className="mxForm mxSubForm" onSubmit={(event) => void submit(event)} aria-label="Add bank account">
    <h3>Add bank account</h3>
    <label className="mxField">Account holder name<input value={form.accountOwnerName} onChange={set("accountOwnerName")} autoComplete="name" required maxLength={120} /></label>
    <label className="mxField">Bank name<input value={form.bankName} onChange={set("bankName")} required maxLength={120} /></label>
    <label className="mxField">Account number<input value={form.accountNumber} onChange={(event) => setForm((current) => ({ ...current, accountNumber: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" autoComplete="off" required minLength={4} maxLength={17} /></label>
    <label className="mxField">Routing number<input value={form.routingNumber} onChange={(event) => setForm((current) => ({ ...current, routingNumber: event.target.value.replace(/\D/g, "") }))} inputMode="numeric" autoComplete="off" required minLength={9} maxLength={9} /></label>
    <div className="mxField">Account type
      <div className="appSegmented" role="radiogroup" aria-label="Account type">
        {(["checking", "savings"] as const).map((type) => <button type="button" role="radio" aria-checked={form.checkingOrSavings === type} key={type}
          onClick={() => setForm((current) => ({ ...current, checkingOrSavings: type }))}>{type === "checking" ? "Checking" : "Savings"}</button>)}
      </div>
    </div>
    <label className="mxField">Street address<input value={form.streetLine1} onChange={set("streetLine1")} autoComplete="address-line1" required maxLength={120} /></label>
    <label className="mxField">City<input value={form.city} onChange={set("city")} autoComplete="address-level2" required maxLength={80} /></label>
    <label className="mxField">State<input value={form.state} onChange={set("state")} autoComplete="address-level1" placeholder="NY" required minLength={2} maxLength={2} /></label>
    <label className="mxField">ZIP code<input value={form.postalCode} onChange={set("postalCode")} autoComplete="postal-code" inputMode="numeric" required maxLength={10} /></label>
    <div className="mxActions">
      <button className="appButton appButtonPrimary" disabled={busy || !valid}>{busy ? "Saving…" : "Save bank account"}</button>
      <button type="button" className="appButton" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

function PayoutForm({ banks }: { banks: Recipient[] }) {
  const api = useApi();
  const { runPrepared, phase, action, outcomeUnknown, busy, reset } = useAction({ label: "Bank transfer" });
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [wire, setWire] = useState(false);
  const bank = banks.find((item) => item.id === bankId) ?? banks[0];
  const amountValid = amountPattern.test(amount) && Number(amount) > 0;
  const tracking = phase === "tracking";

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!bank || !amountValid) return;
    const json = { bankAccountId: bank.id, amountUsd: amount, rail: wire ? "wire" : "ach" };
    await runPrepared(async () => (await api<{ action: ActionView }>("/api/money/payouts", { method: "POST", json })).action);
  }

  if (phase === "done") return <>
    <TransactionProgress label="Bank transfer" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
    <button type="button" className="appButton appButtonLarge" onClick={() => { reset(); setAmount(""); }}>Send another</button>
  </>;

  return <form className="mxForm" onSubmit={(event) => void submit(event)} aria-label="Send to a bank">
    <label className="mxField">To
      <select value={bank?.id ?? ""} onChange={(event) => setBankId(event.target.value)} disabled={busy || tracking}>
        {banks.map((item) => <option value={item.id} key={item.id}>{bankLabel(item)}</option>)}
      </select>
    </label>
    <label className="mxField">Amount in USD<input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" placeholder="25.00" disabled={busy || tracking} required /></label>
    {amount && !amountValid && <p className="mxFieldError" role="alert">Enter an amount like 25 or 25.50.</p>}
    <div className="mxField">Speed
      <div className="appSegmented" role="radiogroup" aria-label="Transfer type">
        <button type="button" role="radio" aria-checked={!wire} disabled={busy || tracking} onClick={() => setWire(false)}>Bank transfer</button>
        <button type="button" role="radio" aria-checked={wire} disabled={busy || tracking} onClick={() => setWire(true)}>Wire</button>
      </div>
    </div>
    <p className="mxHint">You sign a USDC transfer to Bridge. Bridge sends the dollars to your bank after it receives the USDC.</p>
    <TransactionProgress label="Bank transfer" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
    <button className="appButton appButtonPrimary appButtonLarge" disabled={busy || tracking || !bank || !amountValid}>
      {phase === "preparing" ? "Checking…" : phase === "signing" ? "Confirm with your passkey" : "Review and send"}
    </button>
  </form>;
}

function ActiveBankSend() {
  const { user } = usePrivy();
  const api = useApi();
  const [adding, setAdding] = useState(false);
  const toast = useToast();
  const recipients = useQuery({
    queryKey: ["bank-recipients", user?.id],
    queryFn: async () => (await api<{ recipients: Recipient[] }>("/api/recipients")).recipients.filter((item) => item.kind === "bank"),
    enabled: Boolean(user)
  });
  const banks = recipients.data ?? [];
  const ready = banks.filter((item) => item.verified);

  if (recipients.isPending) return <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading your bank accounts…</div>;
  if (recipients.isError) return <p className="mxNote mxNoteError" role="alert">Your bank accounts are unavailable right now. <button type="button" className="appTextButton" onClick={() => void recipients.refetch()}>Try again</button></p>;

  return <>
    {banks.length > 0 && <dl className="mxSummary" aria-label="Saved bank accounts">
      {banks.map((item) => <div key={item.id}><dt>{item.name}</dt><dd>{lastFour(item) ? `•••• ${lastFour(item)}` : ""}{item.verified ? "" : " · Not ready yet"}</dd></div>)}
    </dl>}
    {adding
      ? <AddBankAccountForm onCancel={() => setAdding(false)} onSaved={(name) => { setAdding(false); toast.success("Bank account saved", name); void recipients.refetch(); }} />
      : <button type="button" className="appButton mxStart" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add bank account</button>}
    {ready.length > 0 ? <PayoutForm key={ready.map((item) => item.id).join(",")} banks={ready} />
      : !adding && <p className="mxHint">Add a bank account to send money to it.</p>}
  </>;
}

/** Send to a bank: saved Bridge bank accounts and a payout form. */
export function BankSendPanel() {
  const account = useBankAccount();
  const stage = account.data ? bankStage(account.data) : null;
  return <section className="mxPanel" aria-labelledby="send-bank">
    <div className="mxPanelHead"><h2 id="send-bank">Send to a bank</h2>
      {stage === "unavailable" ? <span className="mxBadge">Coming soon</span> : <span className="mxHint">Bank transfer · Bridge</span>}</div>
    {account.isPending && <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" />Loading…</div>}
    {account.isError && <p className="mxNote mxNoteError" role="alert">Bank transfers are unavailable right now. <button type="button" className="appTextButton" onClick={() => void account.refetch()}>Try again</button></p>}
    {stage === "unavailable" && <p className="mxHint">Coming soon. You&apos;ll be able to send dollars from your Aura account to a US bank account.</p>}
    {stage && stage !== "unavailable" && stage !== "active" && <p className="mxHint">Set up your bank account on <Link className="appTextButton mxInlineButton" href="/app/deposit#bank">Deposit</Link> first.</p>}
    {stage === "active" && <ActiveBankSend />}
  </section>;
}
