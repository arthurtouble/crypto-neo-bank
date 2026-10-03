"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useAuth } from "@/lib/client/auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CreditCard, Eye, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { CardActivity, CardState, CardView } from "@/lib/cards/service";
import { ApiError, useApi } from "@/lib/client/api";
import { cardElementStyle, loadStripe, type IssuingElement } from "@/lib/client/stripe-issuing";
import { useAction, type ActionView } from "@/lib/client/use-action";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { withPasskey } from "@/lib/client/with-passkey";
import { exampleCard } from "@/lib/example/data";
import { formatDateTime, formatUsd } from "@/lib/format";
import { MoneyPage } from "./money-page";
import { useToast } from "./toast";
import { TransactionProgress } from "./transaction-progress";
import { LoadingState, Notice } from "./states";
import { StatusDot, type StatusTone } from "./status-dot";
import { Sheet } from "./sheet";
import { httpsUrl } from "@/lib/client/safe-url";

type Card = Extract<CardState, { state: "card" }>;
/** Set for guests: every action opens sign-in instead. */
type SignIn = (() => void) | undefined;
const money = (value: string | number) => formatUsd(value);
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

/** The card itself: the brand, the last four digits, and its expiry or Frozen. No number is ever drawn here. */
function CardFace({ card, lastFour }: { card?: CardView; lastFour?: string | null }) {
  if (!card && lastFour !== undefined) return <section className="cdFace cdFaceFrozen" aria-label={lastFour ? `Aura card ending ${lastFour}` : "Aura card"}>
    <div className="cdFaceTop"><strong>Aura</strong><span>Visa</span></div>
    <span className="cdFaceNumber">{lastFour ? `•••• ${lastFour}` : "••••"}</span>
    <div className="cdFaceBottom"><span>Unavailable</span><span>Virtual</span></div>
  </section>;
  if (!card) return <section className="cdFace cdFaceUnissued" aria-label="Aura card preview">
    <div className="cdFaceTop"><strong>Aura</strong><span>Visa</span></div>
    <span className="cdFaceNumber">Not issued</span>
    <div className="cdFaceBottom"><span>Virtual</span></div>
  </section>;
  const frozen = card.status === "frozen";
  return <section className={`cdFace${frozen ? " cdFaceFrozen" : ""}`} aria-label={`Aura card ending ${card.lastFour}`}>
    <div className="cdFaceTop"><strong>Aura</strong><span>{card.brand === "visa" ? "Visa" : card.brand}</span></div>
    <span className="cdFaceNumber">•••• {card.lastFour}</span>
    <div className="cdFaceBottom"><span>{frozen ? "Frozen" : `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}`}</span><span>Virtual</span></div>
  </section>;
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
      const options = { issuingCard: data.card.id, nonce, ephemeralKeySecret, style: cardElementStyle() };
      mounted.current = ([["issuingCardNumberDisplay", numberRef], ["issuingCardExpiryDisplay", expiryRef], ["issuingCardCvcDisplay", cvcRef]] as const).map(([type, ref]) => {
        const element = elements.create(type, options);
        element.mount(ref.current!);
        return element;
      });
      setState("shown");
    } catch (error) { setState("idle"); fail("Card details not shown", error); }
  }

  function close() { for (const element of mounted.current) element.destroy(); mounted.current = []; onClose(); }

  return <Sheet onOpenChange={(open) => { if (!open) close(); }} describedBy="card-details-note">
        <div className="mxDialogHead"><Dialog.Title>Card details</Dialog.Title></div>
        <p id="card-details-note" className="mxDialogNote">Stripe shows these in a secure frame. Aura never sees or stores your card number.</p>
        <dl className="cdSecure" data-testid="card-secure-details">
          <div><dt>Card number</dt><dd ref={numberRef} className="stripeFrame" /></div>
          <div><dt>Expires</dt><dd ref={expiryRef} className="stripeFrame" /></div>
          <div><dt>Security code</dt><dd ref={cvcRef} className="stripeFrame" /></div>
        </dl>
        <div className="mxDialogActions">
          {state !== "shown" && <button type="button" className="appButton appButtonPrimary" disabled={state === "loading" || !data.publishableKey} onClick={() => void reveal()}>
            {state === "loading" ? <LoaderCircle className="spin" aria-hidden="true" /> : <Eye aria-hidden="true" />} Confirm with your passkey</button>}
          <Dialog.Close className="appButton">Close</Dialog.Close>
        </div>
  </Sheet>;
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

  return <div className="cdSetting">
    <div className="cdSettingText"><strong>Apple Pay and Google Pay</strong><small>{eligible ? "Add your card to your phone's wallet." : "Your card isn't eligible for phone wallets yet."}</small>
      <div ref={appleRef} data-testid="wallet-apple" /><div ref={googleRef} data-testid="wallet-google" /></div>
    {eligible && !shown && <button type="button" className="appButton" disabled={busy} onClick={() => void start()}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : "Add to phone"}</button>}
  </div>;
}

function Allowance({ data, onSignIn }: { data: Card; onSignIn: SignIn }) {
  const api = useApi();
  const client = useQueryClient();
  const { runPrepared, phase, action, outcomeUnknown, busy, reset } = useAction({ label: "Card allowance", onSettled: () => void client.invalidateQueries({ queryKey: ["card"] }) });
  const [amount, setAmount] = useState("");
  const allowance = data.allowance;
  const valid = /^\d{1,6}(\.\d{1,2})?$/.test(amount) && Number(amount) > 0;
  const spending = allowance.status === "available" && Number(allowance.allowanceUsd) > 0;
  const prepare = (amountUsd: string) => runPrepared(async () => (await api<{ action: ActionView }>("/api/cards/allowance", { method: "POST", json: { amountUsd } })).action);
  async function submit(event: FormEvent) {
    event.preventDefault();
    if (onSignIn) return onSignIn();
    if (!valid) return;
    await prepare(amount);
  }
  /** Approve 0: the card can't take any USDC until a new allowance is set. Signed with the passkey like any allowance. */
  async function turnOff() {
    if (onSignIn) return onSignIn();
    await prepare("0");
  }
  return <section className="mxCard" aria-labelledby="allowance-heading"><h2 id="allowance-heading">Spending allowance</h2>
    <p className="mxHint">Your card spends your USDC on Base. Nothing moves until you buy something: then Bridge takes exactly the purchase from your account, up to this allowance.</p>
    <dl className="mxSummary" data-testid="card-allowance">
      <div><dt>Card can spend</dt><dd className={allowance.status === "available" ? undefined : "appUnavailable"}>{allowance.status === "available" ? money(allowance.allowanceUsd) : "Unavailable"}</dd></div>
      <div><dt>Your USDC</dt><dd className={allowance.status === "available" ? undefined : "appUnavailable"}>{allowance.status === "available" ? money(allowance.balanceUsd) : "Unavailable"}</dd></div>
    </dl>
    {allowance.status === "available" && Number(allowance.allowanceUsd) === 0 && <Notice tone="warning" role="status">Set an allowance to start using your card.</Notice>}
    {phase === "done" ? <>
      <TransactionProgress label="Card allowance" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
      <button type="button" className="appButton" onClick={() => { reset(); setAmount(""); }}>Change it again</button>
    </> : <form className="mxForm" onSubmit={(event) => void submit(event)} aria-label="Set spending allowance">
      <label className="mxField">New allowance in USD<input value={amount} inputMode="decimal" autoComplete="off" placeholder="500" disabled={busy}
        onChange={(event) => setAmount(event.target.value.replace(/[^\d.]/g, ""))} /></label>
      <TransactionProgress label="Card allowance" phase={phase} action={action} outcomeUnknown={outcomeUnknown} />
      <button type="submit" className="appButton appButtonPrimary" disabled={busy || (!onSignIn && !valid)}>{onSignIn ? "Sign in to set an allowance" : phase === "signing" ? "Confirm with your passkey" : "Set allowance"}</button>
    </form>}
    {phase !== "done" && spending && <div className="cdSetting cdAllowanceOff">
      <div className="cdSettingText"><strong>Turn off card spending</strong><small>Sets the allowance to $0.00, so every purchase is declined until you set a new one. Needs your passkey.</small></div>
      <button type="button" className="appButton" disabled={busy} onClick={() => void turnOff()}>Turn off</button>
    </div>}
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
  return <form onSubmit={(event) => void submit(event)} aria-label="Dispute this payment" className="mxForm cdDispute">
    <label className="mxField">What happened?<select value={reason} onChange={(event) => setReason(event.target.value as typeof reason)}>
      {disputeReasons.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
    <label className="mxField">Tell us more<textarea value={explanation} minLength={10} maxLength={1000} required onChange={(event) => setExplanation(event.target.value)}
      placeholder="When it happened, and whether you contacted the merchant." /></label>
    <p className="mxHint">You can send a dispute once, so include everything. If you think someone else has your card, freeze it first.</p>
    <button type="submit" className="appButton appButtonPrimary mxStart" disabled={busy || explanation.trim().length < 10}>{busy ? "Sending…" : "Send dispute"}</button>
  </form>;
}

const statusOf = (item: CardActivity): { label: string; tone: StatusTone } => item.status === "declined" ? { label: "Declined", tone: "negative" } : item.status === "reversed" ? { label: "Reversed", tone: "neutral" }
  : item.status === "pending" ? { label: "Pending", tone: "warning" } : item.kind === "refund" ? { label: "Refunded", tone: "positive" } : { label: "Paid", tone: "positive" };

function Activity({ data, onSignIn }: { data: Card; onSignIn: SignIn }) {
  const client = useQueryClient();
  const [disputing, setDisputing] = useState<string | null>(null);
  return <section className="mxCard cdActivity" aria-labelledby="card-activity-heading"><h2 id="card-activity-heading">Card activity</h2>
    {data.activityStatus === "unavailable" && <Notice tone="warning" role="status">Card activity couldn&apos;t be loaded from Stripe. Try again.</Notice>}
    {data.activity.length === 0 && data.activityStatus === "available" && <p className="mxHint">No card payments yet.</p>}
    {data.activity.length > 0 && <ul className="cdRows">{data.activity.map((item) => {
      const status = statusOf(item);
      return <li key={item.id} className="cardActivityRow cdRow" data-testid={`card-activity-${item.id}`}>
        <span className="appIconDisc" aria-hidden="true"><CreditCard /></span>
        <div className="cdRowText"><strong>{item.merchant ?? "Card payment"}</strong>
          <small>{formatDateTime(item.createdAt)}{item.dispute ? ` · Dispute ${item.dispute.status}` : ""}</small></div>
        <div className="cdRowAmount"><strong>{item.kind === "refund" ? "+" : ""}{money(item.amountUsd)}</strong>
          <StatusDot tone={status.tone} label={status.label} size="small" />
          {item.disputable && disputing !== item.id && <button type="button" className="appTextButton cdRowAction" onClick={() => onSignIn ? onSignIn() : setDisputing(item.id)}>Dispute</button>}</div>
        {disputing === item.id && <Dispute item={item} onDone={() => { setDisputing(null); void client.invalidateQueries({ queryKey: ["card"] }); }} />}
      </li>;
    })}</ul>}
  </section>;
}

/** A lost or stolen card: Stripe cancels it and issues a new number. Needs the passkey. */
function ReplaceCard({ data, onSignIn }: { data: Card; onSignIn: SignIn }) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState<"lost" | "stolen">("lost");
  const [busy, setBusy] = useState(false);
  async function replace() {
    setBusy(true);
    try {
      const next = await withPasskey((confirmation) => api<CardState>("/api/cards/replace", { method: "POST", json: { cardId: data.card.id, reason, confirmation } }), authorize);
      client.setQueryData(["card", user?.id], next);
      toast.success("Your new card is ready", "The old card can't be used any more.");
      setOpen(false);
    } catch (error) { fail("Card not replaced", error); }
    finally { setBusy(false); }
  }
  return <div className="cdSetting cdReplace">
    <div className="cdSettingText"><strong>Replace card</strong><small>{open ? "Your card is canceled for good and you get a new number. Update it wherever you saved it. Needs your passkey."
      : "If your card is lost or stolen, cancel it and get a new one."}</small>
      {open && <div className="appSegmented" role="radiogroup" aria-label="Why are you replacing it?">
        {(["lost", "stolen"] as const).map((value) => <button type="button" role="radio" aria-checked={reason === value} key={value} disabled={busy}
          onClick={() => setReason(value)}>{value === "lost" ? "Lost" : "Stolen"}</button>)}
      </div>}
    </div>
    {open ? <div className="cdReplaceActions">
      <button type="button" className="appButton appButtonPrimary" disabled={busy} onClick={() => void replace()}>
        {busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null} Cancel card and get a new one</button>
      <button type="button" className="appButton" disabled={busy} onClick={() => setOpen(false)}>Keep this card</button>
    </div> : <button type="button" className="appButton" onClick={() => onSignIn ? onSignIn() : setOpen(true)}>Replace</button>}
  </div>;
}

function CardControls({ data, onSignIn }: { data: Card; onSignIn: SignIn }) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);
  const [limit, setLimit] = useState<string | null>(null);
  const frozen = data.card.status === "frozen";
  async function change(json: { frozen?: boolean; dailyLimitUsd?: number }, done: string) {
    if (onSignIn) return onSignIn();
    setBusy(true);
    try {
      const next = await withPasskey((confirmation) => api<CardState>("/api/cards/controls", { method: "PATCH", json: { ...json, confirmation } }), authorize);
      client.setQueryData(["card", user?.id], next);
      toast.success(done);
    } catch (error) { fail("Card not changed", error); }
    finally { setBusy(false); setLimit(null); }
  }
  const limitValue = limit ?? String(data.card.dailyLimitUsd ?? "");
  return <section className="mxCard" aria-labelledby="card-controls-heading"><h2 id="card-controls-heading">Card controls</h2>
    <div className="cdSetting">
      <div className="cdSettingText"><strong>{frozen ? "Card is frozen" : "Freeze card"}</strong><small>{frozen ? "Nothing can be paid with it. Unfreezing needs your passkey." : "Stop all payments straight away. You can unfreeze it later."}</small></div>
      <button type="button" className="appToggle" aria-pressed={frozen} aria-label="Freeze card" disabled={busy}
        onClick={() => void change({ frozen: !frozen }, frozen ? "Card unfrozen" : "Card frozen")}>{frozen ? "On" : "Off"}</button>
    </div>
    <form className="cdSetting cdLimit" onSubmit={(event) => { event.preventDefault(); const value = Number(limitValue); if (value >= 1) void change({ dailyLimitUsd: value }, "Daily limit updated"); }}>
      <div className="cdSettingText"><strong>Daily limit</strong><small>The most the card can spend in a day, in USD. Raising it needs your passkey.</small></div>
      <div className="cdLimitField">
        <label className="mxField"><span className="srOnly">Daily limit in USD</span><input inputMode="numeric" autoComplete="off" value={limitValue} disabled={busy} onChange={(event) => setLimit(event.target.value.replace(/\D/g, ""))} /></label>
        <button type="submit" className="appButton" disabled={busy || (!onSignIn && (limit === null || Number(limitValue) < 1))}>Save</button>
      </div>
    </form>
    {data.walletsEnabled && <PhoneWallets data={data} />}
    <ReplaceCard data={data} onSignIn={onSignIn} />
  </section>;
}

/** Journey J10: the card, its details and controls, the allowance, and its payments. */
function IssuedCard({ data, onSignIn }: { data: Card; onSignIn: SignIn }) {
  const [details, setDetails] = useState(false);
  const { card } = data;
  const active = card.status === "active";
  return <div className="cdLayout">
    <div className="cdHero">
      <CardFace card={card} />
      <div className="cdHeroInfo">
        <StatusDot tone={active ? "positive" : "warning"} label={active ? "Active" : card.status === "frozen" ? "Frozen" : "Canceled"} size="small" />
        <p className="mxHint">Issued by Stripe with Bridge. Daily limit {card.dailyLimitUsd === null ? "not set" : money(card.dailyLimitUsd)}.</p>
        <button type="button" className="appButton mxStart" onClick={() => onSignIn ? onSignIn() : setDetails(true)}><Eye aria-hidden="true" /> Show card details</button>
      </div>
    </div>
    <div className="cdSide">
      <CardControls data={data} onSignIn={onSignIn} />
      <Allowance data={data} onSignIn={onSignIn} />
    </div>
    <Activity data={data} onSignIn={onSignIn} />
    {details && <CardDetails data={data} onClose={() => setDetails(false)} />}
  </div>;
}

/** Stripe couldn't be read: nothing about the card is shown as current, but Freeze still goes through. */
function UnavailableCard({ data, refetch, checking }: { data: Extract<CardState, { state: "card_unavailable" }>; refetch: () => void; checking: boolean }) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { authorize } = useAuraWallet();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);
  async function freeze() {
    setBusy(true);
    try {
      client.setQueryData(["card", user?.id], await withPasskey((confirmation) => api<CardState>("/api/cards/controls", { method: "PATCH", json: { frozen: true, confirmation } }), authorize));
      toast.success("Card frozen");
    } catch (error) { fail("Card not frozen", error); }
    finally { setBusy(false); }
  }
  return <div className="cdSetup">
    <section className="mxPanel" aria-labelledby="card-unavailable-title">
      <div className="mxPanelHead"><h2 id="card-unavailable-title">Your card is unavailable right now</h2>
        <p>We can&apos;t reach Stripe, so your card&apos;s status, controls and payments can&apos;t be shown. You can still try to freeze it.</p></div>
      <div className="mxActions">
        <button type="button" className="appButton appButtonPrimary" disabled={busy} onClick={() => void freeze()}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : null} Freeze card</button>
        <button type="button" className="appButton" disabled={checking} onClick={refetch}>{checking ? "Checking…" : "Try again"}</button>
      </div>
    </section>
    <CardFace lastFour={data.lastFour} />
  </div>;
}

const setupSteps = ["Verify your identity with Bridge", "Apply for the card", "Create your card", "Set a spending allowance"];

/** Journey J9: what's left before there's a card, as a checklist with the one current step's button. */
function Setup({ data, refetch, checking }: { data: Exclude<CardState, { state: "card" | "card_unavailable" }>; refetch: () => void; checking: boolean }) {
  const api = useApi();
  const client = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const fail = useCardErrors();
  const [busy, setBusy] = useState(false);

  async function apply() {
    setBusy(true);
    // Open the tab during the click so the browser doesn't block it; point it at Bridge once the link exists.
    const tab = window.open("", "_blank");
    try {
      const { url } = await api<{ url: string }>("/api/cards/apply", { method: "POST" });
      const link = httpsUrl(url);
      if (!link) throw new ApiError(502, "bad_link", "The link we got back isn't safe to open. Try again.");
      if (tab) { tab.opener = null; tab.location.href = link; }
    } catch (error) { tab?.close(); toast.error("Application didn't start", error instanceof ApiError ? error.message : "Try again."); }
    finally { setBusy(false); }
  }
  async function create() {
    setBusy(true);
    try { client.setQueryData(["card", user?.id], await api<CardState>("/api/cards", { method: "POST" })); toast.success("Your card is ready"); }
    catch (error) { fail("Card not created", error); }
    finally { setBusy(false); }
  }

  const current = data.state === "verify_first" ? 0 : data.state === "apply" ? 1 : data.state === "ready_to_create" ? 2 : -1;
  const step = data.state === "unavailable" ? { title: "Cards are coming soon", body: "A Visa card that spends the USDC in your Aura account, issued by Stripe with Bridge.", action: null }
    : data.state === "verify_first" ? { title: "Verify your identity first", body: "Bridge verifies you once for your bank account and your card.",
      action: <Link className="appButton appButtonPrimary" href="/app/deposit">Verify on Deposit</Link> }
      : data.state === "apply" ? { title: data.approval === "revoked" ? "Confirm your details again" : "Apply for an Aura card",
        body: data.approval === "revoked" ? "Your card approval expired before a card was made. Bridge will ask you to confirm your details."
          : data.approval === "incomplete" ? `Bridge needs more before it can approve a card.${data.issues.length ? ` (${data.issues.join(", ")})` : ""}` : "Bridge checks you're eligible for a card. It usually takes a minute.",
        action: <><button type="button" className="appButton appButtonPrimary" disabled={busy} onClick={() => void apply()}>Apply with Bridge</button>
          <button type="button" className="appButton" disabled={checking} onClick={refetch}>{checking ? "Checking…" : "Check status"}</button></> }
        : { title: "You're approved", body: "Create your virtual Visa card now. Bridge's approval lasts 24 hours.",
          action: <button type="button" className="appButton appButtonPrimary" disabled={busy} onClick={() => void create()}>{busy ? <LoaderCircle className="spin" aria-hidden="true" /> : <ShieldCheck aria-hidden="true" />} Create my card</button> };
  return <div className="cdSetup">
    <section className="mxPanel" aria-labelledby="card-step-title">
      <div className="mxPanelHead"><h2 id="card-step-title">{step.title}</h2><p>{step.body}</p></div>
      {current >= 0 && <ol className="mxChecklist" aria-label="Get your card">
        {setupSteps.map((label, index) => <li key={label} className={index < current ? "isDone" : index === current ? "isCurrent" : undefined}>{label}</li>)}
      </ol>}
      {step.action && <div className="mxActions">{step.action}</div>}
    </section>
    <CardFace />
  </div>;
}

/** The Cards page: the steps to get a card, or the card itself. Guests see a labelled example card. */
export function CardWorkspace() {
  const { authenticated, ready, login, user } = useAuth();
  const api = useApi();
  const isExample = ready && !authenticated;
  const loading = !ready;
  const query = useQuery({ queryKey: ["card", user?.id], queryFn: () => api<CardState>("/api/cards"), enabled: authenticated && Boolean(user) });

  return <MoneyPage title="Cards" guest={isExample || loading} onSignIn={login} ready={ready} className="cdPage">
    {isExample ? <IssuedCard data={exampleCard} onSignIn={login} />
      : loading || query.isPending ? <LoadingState><strong>Loading your card</strong></LoadingState>
        : query.isError ? <Notice tone="error" role="alert" onRetry={() => void query.refetch()}>Your card couldn&apos;t be loaded.</Notice>
          : query.data.state === "card" ? <IssuedCard data={query.data} onSignIn={undefined} />
            : query.data.state === "card_unavailable" ? <UnavailableCard data={query.data} refetch={() => void query.refetch()} checking={query.isFetching} />
            : <Setup data={query.data} refetch={() => void query.refetch()} checking={query.isFetching} />}
  </MoneyPage>;
}
