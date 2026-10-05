"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useApi } from "@/lib/client/api";
import { useAction, type ActionView } from "@/lib/client/use-action";
import { bankStage, useBankAccount } from "@/lib/client/use-bank-account";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { formatDateTime, formatUsd } from "@/lib/format";
import { formatUnits } from "@/lib/format/units";
import { useTokenBalances } from "@/lib/client/wallet-context";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";
import { LoadingState, Notice } from "./states";

type Recipient = { id: string; kind: "wallet" | "bank"; name: string; detail: string; verified: boolean; availableAt?: string | null };

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
      <button type="submit" className="appButton appButtonPrimary" disabled={busy || !valid}>{busy ? "Saving…" : "Save bank account"}</button>
      <button type="button" className="appButton" disabled={busy} onClick={onCancel}>Cancel</button>
    </div>
  </form>;
}

const usd = (value: string) => formatUsd(value);
/** Shown under Speed while choosing, and again on the review. */
const arrival = (wire: boolean) => wire ? "Usually within 1 business day" : "Usually 1 to 3 business days";

function PayoutForm({ banks, onReviewing }: { banks: Recipient[]; onReviewing: (reviewing: boolean) => void }) {
  const api = useApi();
  const { runPrepared, phase, action, outcomeUnknown, busy, reset, wallet } = useAction({ label: "Bank transfer" });
  // Payouts are paid from USDC on Base, read from the chain; an unread balance is "unavailable", never zero.
  const balance = useTokenBalances([{ token: BASE_USDC, chainId: BASE_CHAIN_ID }], wallet.address);
  const usdc = balance.data?.[0];
  const [bankId, setBankId] = useState(banks[0]?.id ?? "");
  const [amount, setAmount] = useState("");
  const [wire, setWire] = useState(false);
  // Journey J6, change B1: the customer reviews the payout before the passkey, as with every other money action.
  const [reviewing, setReviewingState] = useState(false);
  const setReviewing = (value: boolean) => { setReviewingState(value); onReviewing(value); };
  const bank = banks.find((item) => item.id === bankId) ?? banks[0];
  const amountValid = amountPattern.test(amount) && Number(amount) > 0;
  const tracking = phase === "tracking";

  function review(event: FormEvent) {
    event.preventDefault();
    if (bank && amountValid) setReviewing(true);
  }

  async function confirm() {
    if (!bank || !amountValid) return;
    const json = { bankAccountId: bank.id, amountUsd: amount, rail: wire ? "wire" : "ach" };
    await runPrepared(async () => (await api<{ action: ActionView }>("/api/money/payouts", { method: "POST", json })).action);
  }

  if (phase === "done") return <>
    <TransactionProgress label="Bank transfer" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
    <button type="button" className="appButton appButtonLarge" onClick={() => { reset(); setAmount(""); setReviewing(false); }}>Send another</button>
  </>;

  if (reviewing && bank) return <section className="mxForm" aria-label="Review bank transfer">
    <dl className="mxSummary" data-testid="bank-review">
      <div><dt>Send</dt><dd>{usd(amount)}</dd></div>
      <div><dt>From your USDC</dt><dd>{amount} USDC</dd></div>
      {usdc !== undefined && <div><dt>Available</dt><dd>{formatUsd(formatUnits(usdc, 6))}</dd></div>}
      <div><dt>To</dt><dd>{bankLabel(bank)}</dd></div>
      <div><dt>Speed</dt><dd>{wire ? "Wire" : "Bank transfer"}</dd></div>
      <div><dt>Arrives</dt><dd>{arrival(wire)}</dd></div>
    </dl>
    <p className="mxHint">Your USDC goes to Bridge, our banking partner, and Bridge sends the dollars to your bank. Arrival times are estimates, and a bank or Bridge can still hold or return a transfer.</p>
    <TransactionProgress label="Bank transfer" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
    <div className="mxActions mxActionsStack">
      <button type="button" className="appButton appButtonPrimary appButtonLarge" disabled={busy || tracking} onClick={() => void confirm()}>
        {phase === "preparing" ? "Checking…" : phase === "signing" ? "Confirm with your passkey" : "Send"}</button>
      <button type="button" className="appButton appButtonLarge" disabled={busy || tracking} onClick={() => setReviewing(false)}>Edit</button>
    </div>
  </section>;

  return <form className="mxForm" onSubmit={review} aria-label="Send to a bank">
    <label className="mxField">To
      <select value={bank?.id ?? ""} onChange={(event) => setBankId(event.target.value)}>
        {banks.map((item) => <option value={item.id} key={item.id}>{bankLabel(item)}</option>)}
      </select>
    </label>
    <label className="mxField">Amount in USD<input value={amount} onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" autoComplete="off" placeholder="25.00" required /></label>
    <p className="mxHint">{usdc === undefined ? "Balance unavailable" : `${formatUsd(formatUnits(usdc, 6))} available`}
      {usdc !== undefined && usdc >= 10_000n && <> · <button type="button" className="appTextButton mxInlineButton"
        onClick={() => setAmount((Number(usdc / 10_000n) / 100).toFixed(2))}>Max</button></>}</p>
    {amount && !amountValid && <p className="mxFieldError" role="alert">Enter an amount like 25 or 25.50.</p>}
    <div className="mxField">Speed
      <div className="appSegmented" role="radiogroup" aria-label="Transfer type">
        <button type="button" role="radio" aria-checked={!wire} onClick={() => setWire(false)}>Bank transfer</button>
        <button type="button" role="radio" aria-checked={wire} onClick={() => setWire(true)}>Wire</button>
      </div>
      <span className="mxHint">{arrival(wire)}</span>
    </div>
    <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={!bank || !amountValid}>Review</button>
  </form>;
}

function ActiveBankSend() {
  const { user } = useAuth();
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
  const [removing, setRemoving] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [busy, setBusy] = useState(false);

  async function remove(bank: Recipient) {
    setBusy(true);
    try {
      await api("/api/money/bank-accounts", { method: "DELETE", json: { bankAccountId: bank.id } });
      toast.success("Bank account removed", bankLabel(bank));
      setRemoving(null);
      void recipients.refetch();
    } catch (reason) { toast.error("Bank account not removed", reason instanceof Error ? reason.message : "Try again."); }
    finally { setBusy(false); }
  }

  if (recipients.isPending) return <LoadingState label="Loading your bank accounts…" />;
  if (recipients.isError) return <Notice tone="error" role="alert" onRetry={() => void recipients.refetch()}>Your saved bank accounts can&apos;t be loaded right now.</Notice>;

  return <>
    {banks.length > 0 && !reviewing && <dl className="mxSummary" aria-label="Saved bank accounts">
      {banks.map((item) => <div key={item.id} data-testid="saved-bank"><dt>{item.name}{lastFour(item) ? ` •••• ${lastFour(item)}` : ""}</dt>
        <dd className="mxBankRow">{item.verified ? "" : item.availableAt ? `Ready from ${formatDateTime(item.availableAt)}` : "Not ready yet"}
          {removing === item.id ? <>
            <button type="button" className="appTextButton mxInlineButton" disabled={busy} onClick={() => void remove(item)}>{busy ? "Removing…" : "Remove"}</button>
            <button type="button" className="appTextButton mxInlineButton" disabled={busy} onClick={() => setRemoving(null)}>Keep</button>
          </> : <button type="button" className="appTextButton mxInlineButton" aria-label={`Remove ${bankLabel(item)}`} onClick={() => setRemoving(item.id)}>Remove</button>}
        </dd></div>)}
    </dl>}
    {reviewing ? null : adding
      ? <AddBankAccountForm onCancel={() => setAdding(false)} onSaved={(name) => { setAdding(false); toast.success("Bank account saved", name); void recipients.refetch(); }} />
      : <button type="button" className="appButton mxStart" onClick={() => setAdding(true)}><Plus aria-hidden="true" /> Add bank account</button>}
    {ready.length > 0 ? <PayoutForm key={ready.map((item) => item.id).join(",")} banks={ready} onReviewing={setReviewing} />
      : !adding && <p className="mxHint">{banks.length ? "Your bank account can receive money once its waiting period ends." : "Add a bank account to send money to it."}</p>}
  </>;
}

/** Send to a bank: saved Bridge bank accounts and a payout form. */
export function BankSendPanel() {
  const account = useBankAccount();
  const stage = account.data ? bankStage(account.data) : null;
  return <section className="mxPanel" aria-labelledby="send-bank">
    <div className="mxPanelHead"><h2 id="send-bank">Send to a bank</h2>
      {stage === "unavailable" ? <span className="mxBadge">Coming soon</span> : <span className="mxHint">US bank transfer</span>}</div>
    {account.isPending && <LoadingState label="Loading…" />}
    {account.isError && <Notice tone="error" role="alert" onRetry={() => void account.refetch()}>Bank transfers are unavailable right now.</Notice>}
    {stage === "unavailable" && <p className="mxHint">Coming soon. You&apos;ll be able to send dollars from your Aura account to a US bank account.</p>}
    {stage && stage !== "unavailable" && stage !== "active" && <p className="mxHint">Set up your bank account under <Link className="appTextButton mxInlineButton" href="/app/deposit#bank">Add money</Link> first.</p>}
    {stage === "active" && <ActiveBankSend />}
  </section>;
}
