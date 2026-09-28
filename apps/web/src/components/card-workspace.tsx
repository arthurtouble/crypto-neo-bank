"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Eye, Gauge, LoaderCircle, LockKeyhole, ShieldCheck, Smartphone, Unlock, Wallet } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { CardActivity, CardState } from "@/lib/cards/service";
import { ApiError, useApi } from "@/lib/client/api";
import { cardElementStyle, loadStripe, type IssuingElement } from "@/lib/client/stripe-issuing";
import { useAction, type ActionView } from "@/lib/client/use-action";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { withPasskey } from "@/lib/client/with-passkey";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";

type Card = Extract<CardState, { state: "card" }>;
const money = (value: string | number) => `$${Number(value).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const disputeReasons = [["fraudulent", "I didn't make this payment"], ["not_received", "I didn't get what I paid for"], ["duplicate", "I was charged twice"],
  ["canceled", "I canceled it"], ["other", "Something else"]] as const;

function useCardErrors() {
  const toast = useToast();
  const { enrollPasskey } = useAuraWallet();
  return (title: string, error: unknown) => {
    if (error instanceof ApiError && error.code === "mfa_required") { toast.error("Add a passkey first", "Your card needs a passkey on your account."); enrollPasskey(); return; }
    toast.error(title, error instanceof ApiError ? error.message : "You cancelled the passkey check, so nothing changed.");
  };
}

/** Card number, expiry, and security code, shown by Stripe in its own frames after a passkey check. */
function CardDetails({ data, onClose }: { data: Card; onClose: () => void }) {
  const api = useApi();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [state, setState] = useState<"idle" | "loading" | "shown">("idle");
  const mounted = useRef<IssuingElement[]>([]);
  const numberRef = useRef<HTMLDivElement>(null);
  const expiryRef = useRef<HTMLDivElement>(null);
  const cvcRef = useRef<HTMLDivElement>(null);

  async function reveal() {
    if (!data.publishableKey) return;
    setState("loading");
    try {
      const stripe = await loadStripe(data.publishableKey);
      const { nonce } = await stripe.createEphemeralKeyNonce({ issuingCard: data.card.id });
      if (!nonce) throw new Error("Stripe didn't start.");
      const { ephemeralKeySecret } = await withPasskey((confirmation) => api<{ ephemeralKeySecret: string }>("/api/cards/details-key",
        { method: "POST", json: { nonce, confirmation } }), authorize);
      await stripe.retrieveIssuingCard(data.card.id, { ephemeralKeySecret, nonce });
      const elements = stripe.elements();
      const options = { issuingCard: data.card.id, nonce, ephemeralKeySecret, style: cardElementStyle };
      mounted.current = ([["issuingCardNumberDisplay", numberRef], ["issuingCardExpiryDisplay", expiryRef], ["issuingCardCvcDisplay", cvcRef]] as const).map(([type, ref]) => {
        const element = elements.create(type, options);
        element.mount(ref.current!);
        return element;
      });
      setState("shown");
    } catch (error) { setState("idle"); fail("Card details not shown", error); }
  }

  function close() { for (const element of mounted.current) element.destroy(); mounted.current = []; onClose(); }

  return <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && close()}>
    <section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="card-details-title">
      <h2 id="card-details-title">Card details</h2>
      <p>Stripe shows these in a secure frame. Aura never sees or stores your card number.</p>
      <div className="cardSecureDetails" data-testid="card-secure-details">
        <span>Card number<div ref={numberRef} className="stripeFrame" /></span>
        <span>Expires<div ref={expiryRef} className="stripeFrame" /></span>
        <span>Security code<div ref={cvcRef} className="stripeFrame" /></span>
      </div>
      {state !== "shown" && <button className="button primary" disabled={state === "loading" || !data.publishableKey} onClick={() => void reveal()}>
        {state === "loading" ? <LoaderCircle className="spin" size={14} /> : <Eye size={14} />} Confirm with your passkey</button>}
      <button className="button secondary" style={{ marginLeft: 8 }} onClick={close}>Close</button>
    </section>
  </div>;
}

/** Apple Pay and Google Pay, through Stripe's Add to Wallet button (a Stripe preview that only works with live cards). */
function PhoneWallets({ data }: { data: Card }) {
  const api = useApi();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState(false);
  const appleRef = useRef<HTMLDivElement>(null);
  const googleRef = useRef<HTMLDivElement>(null);
  const eligible = data.card.wallets.applePay || data.card.wallets.googlePay;

  async function start() {
    if (!data.publishableKey) return;
    setBusy(true);
    try {
      const stripe = await loadStripe(data.publishableKey);
      const { nonce } = await stripe.createEphemeralKeyNonce({ issuingCard: data.card.id });
      if (!nonce) throw new Error("Stripe didn't start.");
      const { ephemeralKeySecret } = await withPasskey((confirmation) => api<{ ephemeralKeySecret: string }>("/api/cards/details-key",
        { method: "POST", json: { nonce, confirmation } }), authorize);
      const elements = stripe.elements();
      if (data.card.wallets.applePay) elements.create("issuingAddToWalletButton", { issuingCard: data.card.id, nonce, ephemeralKeySecret, wallet: "apple" }).mount(appleRef.current!);
      if (data.card.wallets.googlePay) elements.create("issuingAddToWalletButton", { issuingCard: data.card.id, nonce, ephemeralKeySecret, wallet: "google" }).mount(googleRef.current!);
      setShown(true);
    } catch (error) { fail("Couldn't add to your phone", error); }
    finally { setBusy(false); }
  }

  return <div className="settingRow"><span className="settingIcon"><Smartphone size={17} /></span>
    <div><strong>Apple Pay and Google Pay</strong><small>{eligible ? "Add your card to your phone's wallet." : "Your card isn't eligible for phone wallets yet."}</small>
      <div ref={appleRef} data-testid="wallet-apple" /><div ref={googleRef} data-testid="wallet-google" /></div>
    {eligible && !shown && <button disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" size={14} /> : "Add to phone"}</button>}
  </div>;
}

function Allowance({ data }: { data: Card }) {
  const api = useApi();
  const { runPrepared, phase, action, outcomeUnknown, busy, reset } = useAction({ label: "Card allowance", onSettled: () => void client.invalidateQueries({ queryKey: ["card"] }) });
  const client = useQueryClient();
  const [amount, setAmount] = useState("");
  const allowance = data.allowance;
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!valid) return;
    await runPrepared(async () => (await api<{ action: ActionView }>("/api/cards/allowance", { method: "POST", json: { amountUsd: amount } })).action);
  }
  return <section className="panel settingsPanel" aria-labelledby="allowance-heading"><h2 id="allowance-heading">Spending allowance</h2>
    <p className="sourceCaption">Your card spends your USDC on Base. Nothing moves until you buy something: then Bridge takes exactly the purchase from your account, up to this allowance.</p>
    <div className="bankDetails" data-testid="card-allowance">
      <span>Card can spend<strong>{allowance.status === "available" ? money(allowance.allowanceUsd) : "Unavailable"}</strong></span>
      <span>Your USDC<strong>{allowance.status === "available" ? money(allowance.balanceUsd) : "Unavailable"}</strong></span>
    </div>
    {allowance.status === "available" && Number(allowance.allowanceUsd) === 0 && <p className="formError" role="status">Set an allowance to start using your card.</p>}
    {phase === "done" ? <>
      <TransactionProgress label="Card allowance" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
      <button className="button secondary" onClick={() => { reset(); setAmount(""); }}>Change it again</button>
    </> : <form onSubmit={(event) => void submit(event)} aria-label="Set spending allowance">
      <label className="fieldLabel">New allowance in USD<input value={amount} inputMode="decimal" placeholder="500" disabled={busy}
        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label>
      <TransactionProgress label="Card allowance" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
      <button className="button primary" style={{ marginTop: 12 }} disabled={busy || !valid}>{phase === "signing" ? "Confirm with your passkey" : "Set allowance"}</button>
    </form>}
  </section>;
}

function Dispute({ item, onDone }: { item: CardActivity; onDone: () => void }) {
  const api = useApi();
  const toast = useToast();
  const [reason, setReason] = useState<(typeof disputeReasons)[number][0]>("fraudulent");
  const [explanation, setExplanation] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      await api("/api/cards/disputes", { method: "POST", json: { transactionId: item.transactionId, reason, explanation: explanation.trim() } });
      toast.success("Dispute sent", "Visa's process can take weeks. Any credit goes back to your USDC.");
      onDone();
    } catch (error) { toast.error("Dispute not sent", error instanceof ApiError ? error.message : "Try again."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={(event) => void submit(event)} aria-label="Dispute this payment" className="cardDispute">
    <label className="fieldLabel">What happened?<select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
      {disputeReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="fieldLabel">Tell us more<textarea value={explanation} minLength={10} maxLength={1000} required onChange={(event) => setExplanation(event.target.value)}
      placeholder="When it happened, and whether you contacted the merchant." /></label>
    <p className="sourceCaption">You can send a dispute once, so include everything. If you think someone else has your card, freeze it first.</p>
    <button className="button primary" disabled={busy || explanation.trim().length < 10}>{busy ? "Sending…" : "Send dispute"}</button>
  </form>;
}

function Activity({ data }: { data: Card }) {
  const client = useQueryClient();
  const [disputing, setDisputing] = useState<string | null>(null);
  const label = (item: CardActivity) => item.status === "declined" ? "Declined" : item.status === "reversed" ? "Reversed" : item.status === "pending" ? "Pending" : item.kind === "refund" ? "Refunded" : "Paid";
  return <section className="panel settingsPanel" aria-labelledby="card-activity-heading"><h2 id="card-activity-heading">Card activity</h2>
    {data.activityStatus === "unavailable" && <p className="formError">Card activity couldn&apos;t be loaded from Stripe. Try again.</p>}
    {data.activity.length === 0 && data.activityStatus === "available" && <p className="sourceCaption">No card payments yet.</p>}
    {data.activity.map((item) => <div key={item.id} className="settingRow cardActivityRow" data-testid={`card-activity-${item.id}`}>
      <span className="settingIcon"><CreditCard size={17} /></span>
      <div><strong>{item.merchant ?? "Card payment"}</strong><small>{new Date(item.createdAt).toLocaleString()} · {label(item)}
        {item.dispute ? ` · Dispute ${item.dispute.status}` : ""}</small>
        {disputing === item.id && <Dispute item={item} onDone={() => { setDisputing(null); void client.invalidateQueries({ queryKey: ["card"] }); }} />}</div>
      <span className="cardActivityAmount"><strong>{item.kind === "refund" ? "+" : ""}{money(item.amountUsd)}</strong>
        {item.disputable && disputing !== item.id && <button onClick={() => setDisputing(item.id)}>Dispute</button>}</span>
    </div>)}
  </section>;
}

function CardControls({ data }: { data: Card }) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = usePrivy();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<string | null>(null);
  const frozen = data.card.status === "frozen";
  async function change(json: { frozen?: boolean; dailyLimitUsd?: number }, done: string) {
    setBusy(true);
    try {
      const next = await withPasskey((confirmation) => api<CardState>("/api/cards/controls", { method: "PATCH", json: { ...json, confirmation } }), authorize);
      client.setQueryData(["card", user?.id], next);
      toast.success(done);
    } catch (error) { fail("Card not changed", error); }
    finally { setBusy(false); setLimit(null); }
  }
  const limitValue = limit ?? String(data.card.dailyLimitUsd ?? "");
  return <section className="panel settingsPanel" aria-labelledby="card-controls-heading"><h2 id="card-controls-heading">Card controls</h2>
    <div className="settingRow"><span className="settingIcon">{frozen ? <Unlock size={17} /> : <LockKeyhole size={17} />}</span>
      <div><strong>{frozen ? "Card is frozen" : "Freeze card"}</strong><small>{frozen ? "Nothing can be paid with it. Unfreezing needs your passkey." : "Stop all payments straight away. You can unfreeze it later."}</small></div>
      <button className={`settingsToggle ${frozen ? "active" : ""}`} aria-pressed={frozen} aria-label="Freeze card" disabled={busy}
        onClick={() => void change({ frozen: !frozen }, frozen ? "Card unfrozen" : "Card frozen")}>{frozen ? "On" : "Off"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Gauge size={17} /></span>
      <div><strong>Daily limit</strong><small>The most the card can spend in a day, in USD. Raising it needs your passkey.</small></div>
      <form className="cardLimitForm" onSubmit={(event) => { event.preventDefault(); const value = Number(limitValue); if (value >= 1) void change({ dailyLimitUsd: value }, "Daily limit updated"); }}>
        <input aria-label="Daily limit in USD" inputMode="numeric" value={limitValue} disabled={busy} onChange={(event) => setLimit(event.target.value.replace(/\D/g, ""))} />
        <button disabled={busy || limit === null || Number(limitValue) < 1}>Save</button>
      </form></div>
    {data.walletsEnabled && <PhoneWallets data={data} />}
  </section>;
}

function IssuedCard({ data }: { data: Card }) {
  const [details, setDetails] = useState(false);
  const { card } = data;
  return <div className="cardWorkspace">
    <section className="aurelCard issued" aria-label={`Aura card ending ${card.lastFour}`}><div className="cardShine" />
      <div className="membershipTop"><span>AURA</span><span>{card.brand.toUpperCase()}</span></div><CreditCard className="cardPreviewIcon" size={30} />
      <strong className="cardNumber">••••  {card.lastFour}</strong>
      <div className="membershipBottom"><span>{card.status === "frozen" ? "FROZEN" : `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`}</span><b>VIRTUAL</b></div></section>
    <section className="panel cardOverview"><div className="panelHeading"><div><h2>Your card</h2></div>
      <span className={`statusBadge ${card.status === "active" ? "good" : "warning"}`}><i /> {card.status === "active" ? "Active" : "Frozen"}</span></div>
      <button className="button secondary" onClick={() => setDetails(true)}><Eye size={14} /> Show card details</button>
      <p className="sourceCaption">Issued by Stripe with Bridge. Daily limit {card.dailyLimitUsd === null ? "not set" : money(card.dailyLimitUsd)}.</p></section>
    <CardControls data={data} />
    <Allowance data={data} />
    <Activity data={data} />
    {details && <CardDetails data={data} onClose={() => setDetails(false)} />}
  </div>;
}

/** The card screen: the next step to get a card, or the card itself. */
export function CardWorkspace() {
  const { user } = usePrivy();
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);
  const query = useQuery({ queryKey: ["card", user?.id], queryFn: () => api<CardState>("/api/cards"), enabled: Boolean(user) });
  if (query.isPending) return <section className="panel cardWorkspaceLoading"><LoaderCircle className="spin" size={18} /> Loading card</section>;
  if (query.isError) return <section className="panel cardWorkspaceLoading formError">Your card couldn&apos;t be loaded. Try again.</section>;
  const data = query.data;
  if (data.state === "card") return <IssuedCard data={data} />;

  async function apply() {
    setBusy(true);
    // Open the tab during the click so the browser doesn't block it; point it at Bridge once the link exists.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("/api/cards/apply", { method: "POST" });
      if (tab) { tab.opener = null; tab.location.href = url; }
    } catch (error) { tab?.close(); toast.error("Application didn't start", error instanceof ApiError ? error.message : "Try again."); }
    finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try { client.setQueryData(["card", user?.id], await api<CardState>("/api/cards", { method: "POST" })); toast.success("Your card is ready"); }
    catch (error) { fail("Card not created", error); }
    finally { setBusy(false); }
  }

  const step = data.state === "unavailable" ? { title: "Cards are coming soon", body: "A Visa card that spends the USDC in your Aura account, issued by Stripe with Bridge.", action: null }
    : data.state === "verify_first" ? { title: "Verify your identity first", body: "Bridge verifies you once for your bank account and your card.",
      action: <Link className="button primary" href="/app/deposit">Verify on Deposit</Link> }
      : data.state === "apply" ? { title: data.approval === "revoked" ? "Confirm your details again" : "Apply for an Aura card",
        body: data.approval === "revoked" ? "Your card approval expired before a card was made. Bridge will ask you to confirm your details."
          : data.approval === "incomplete" ? `Bridge needs more before it can approve a card.${data.issues.length ? ` (${data.issues.join(", ")})` : ""}` : "Bridge checks you're eligible for a card. It usually takes a minute.",
        action: <><button className="button primary" disabled={busy} onClick={() => void apply()}>Apply with Bridge</button>
          <button className="button secondary" style={{ marginLeft: 8 }} disabled={query.isFetching} onClick={() => void query.refetch()}>{query.isFetching ? "Checking…" : "Check status"}</button></> }
        : { title: "You're approved", body: "Create your virtual Visa card now. Bridge's approval lasts 24 hours.",
          action: <button className="button primary" disabled={busy} onClick={() => void create()}>{busy ? <LoaderCircle className="spin" size={14} /> : <ShieldCheck size={14} />} Create my card</button> };
  return <div className="cardWorkspace">
    <section className="aurelCard unissued" aria-label="Aura card preview"><div className="cardShine" /><div className="membershipTop"><span>AURA</span><span>VISA</span></div>
      <CreditCard className="cardPreviewIcon" size={30} /><strong className="cardNumber">NOT ISSUED</strong><div className="membershipBottom"><span>VIRTUAL</span><b /></div></section>
    <section className="panel cardOverview"><div className="panelHeading"><div><h2>{step.title}</h2></div><Wallet size={18} /></div>
      <p>{step.body}</p>{step.action}</section>
  </div>;
}
