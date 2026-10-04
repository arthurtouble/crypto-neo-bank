"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import type { ActionView } from "@/lib/client/use-action";
import { formatToken, formatUsd } from "@/lib/format";
import { formatCents, parseDollars } from "@/lib/markets/view";
import { parseShares, sellProceeds, setupStepOf, sharesText, typedDecimal } from "@/lib/markets/predictions-view";
import { useBaseUsdc, usePredictionMarket, type ClobQuote, type PolymarketMarket, type PredictionPosition, type PredictionsAccount } from "./markets-data";
import { DollarAmount, FlowTimeline, PayWith, sleep, useFlow, useSettledAction, type FlowStep } from "./markets-parts";
import { predictionErrorMessage } from "./predictions-data";
import { Sheet } from "./sheet";
import { LoadingState, Notice } from "./states";
import { TransactionProgress } from "./transaction-progress";

export type Api = ReturnType<typeof useApi>;
type Authorize = (request: AuthorizationRequest<unknown>) => Promise<string>;
export type SignRequest = { requestId: string; request: AuthorizationRequest<unknown> };
type Setup = { status: "ready"; wallet: string } | { status: "waiting"; wallet: string; transactionId: string } | ({ status: "sign" } & SignRequest);
/** What `/api/predictions/signatures` answers for an order: Polymarket's status and what was swapped (for a buy, dollars for shares; for a sale, shares for dollars). */
export type SignedOrder = { status?: string; order?: { status: "live" | "matched" | "delayed"; makingAmount: string; takingAmount: string } };

/** Seconds between setup checks while Polygon confirms the account or its approvals. */
const SETUP_POLL_MS = 3_000;
const SETUP_MAX_STEPS = 60;
/** How long to wait for Polymarket to credit a deposit before saying so. */
const CREDIT_WAIT_MS = 4 * 60_000;

/**
 * Setting up predictions, as the steps the customer sees: Polymarket creates
 * the account (Aura pays the network fee), the passkey allows it to trade,
 * and the passkey connects it to Polymarket's order book.
 */
export const SETUP_STEPS: FlowStep[] = [
  { key: "create", label: "Create your predictions account", detail: "You do this once." },
  { key: "approve", label: "Allow it to trade", detail: "Confirm with your passkey." },
  { key: "connect", label: "Connect it to Polymarket", detail: "Confirm with your passkey." }
];

const CONFIRMING = "Confirming. This usually takes under a minute.";
const SETUP_ORDER = ["create", "approve", "connect"] as const;
type SetupStage = (typeof SETUP_ORDER)[number];
/** What a finished setup step says, so a done step never keeps its "confirming" line. */
export const SETUP_DONE: Record<SetupStage, string> = { create: "Created.", approve: "Allowed.", connect: "Connected." };

/**
 * Set up the predictions account one server step at a time, until ready:
 * wait while Polygon confirms, and confirm each approval or sign-in with the
 * passkey. `onStep` moves the timeline.
 */
export async function setupPredictions(api: Api, authorize: Authorize, onStep: (key: SetupStage, detail: string) => void) {
  let stage: SetupStage = "create";
  // Every step before `next` is done: say so, in order, before the timeline moves on.
  const doneUpTo = (next: SetupStage | null) => {
    for (const key of SETUP_ORDER) { if (key === next) return; onStep(key, SETUP_DONE[key]); }
  };
  for (let step = 0; step < SETUP_MAX_STEPS; step += 1) {
    const setup = await api<Setup>("/api/predictions/setup", { method: "POST" });
    if (setup.status === "ready") { doneUpTo(null); return; }
    if (setup.status === "waiting") { onStep(stage, CONFIRMING); await sleep(SETUP_POLL_MS); continue; }
    stage = setupStepOf(setup.request);
    doneUpTo(stage);
    onStep(stage, "Confirm with your passkey.");
    const authorization = await authorize(setup.request);
    await api("/api/predictions/signatures", { method: "POST", json: { requestId: setup.requestId, authorization } });
    onStep(stage, stage === "connect" ? "Connecting…" : CONFIRMING);
  }
  throw new Error("Setting up is taking longer than usual. Nothing more was sent. Try again in a few minutes.");
}

/** Ask for a deposit; if Polymarket needs more than the shortfall, ask again for its minimum when the USDC is there. */
export async function prepareDeposit(api: Api, amount: number, usdc: number | null): Promise<ActionView> {
  const request = (value: number) => api<{ action: ActionView }>("/api/predictions/deposit", { method: "POST", json: { amount: value.toFixed(2) } });
  try { return (await request(amount)).action; }
  catch (error) {
    const minimum = error instanceof ApiError && error.code === "amount_too_small" ? Number(/at least ([\d.]+)/.exec(error.message)?.[1]) : NaN;
    if (Number.isFinite(minimum) && minimum > amount && usdc !== null && minimum <= usdc) return (await request(Math.ceil(minimum * 100) / 100)).action;
    throw error;
  }
}

/** A deposit from Base reaches predictions cash a little after it's sent; wait until the cash covers `needed`. */
export async function waitForCredit(api: Api, needed: number) {
  const until = Date.now() + CREDIT_WAIT_MS;
  while (Date.now() < until) {
    const account = await api<PredictionsAccount>("/api/predictions/account").catch(() => null);
    if (account?.balance.status === "observed" && Number(account.balance.data.amount) >= needed) return;
    await sleep(SETUP_POLL_MS);
  }
  throw new Error("Your deposit is on its way but hasn't reached your predictions cash yet. Nothing was bought. Try again in a few minutes.");
}

/**
 * No USDC on Base to deposit or buy with: say so before the customer types,
 * with the one place that fixes it.
 */
export function NoUsdc() {
  return <p className="mxHint pdNoUsdc" data-testid="predictions-no-usdc">You have no USDC in your Aura account to use here yet. <Link href="/app/deposit">Add money</Link></p>;
}

export const cashOf = (account: PredictionsAccount | undefined) => account?.balance.status === "observed" ? Number(account.balance.data.amount) : null;

/** A position's state in words: won and ready to collect, lost, or open. */
export function positionState(position: PredictionPosition): "collect" | "lost" | "open" {
  if (position.redeemable) return position.value > 0 ? "collect" : "lost";
  return "open";
}

/**
 * Sell shares of an outcome the customer holds, at the best price buyers
 * offer now (the sale accepts up to 2% under it), signed with the passkey.
 * Used by the order panel's Sell tab and by a position's Sell.
 */
export function SellForm({ market, quotes, outcome, position, onDone, onBusy, idPrefix = "sell" }: {
  market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; outcome: 0 | 1; position: PredictionPosition | null;
  onDone?: () => void; onBusy?: (busy: boolean) => void; idPrefix?: string;
}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const { flow, start, at, finish, fail, reset, running } = useFlow();
  const [text, setText] = useState("");
  useEffect(() => onBusy?.(running), [onBusy, running]);
  const name = market.outcomes[outcome].name;
  const held = position?.size ?? 0;
  const shares = parseShares(text, held);
  const bestBid = quotes?.find((item) => item.tokenId === market.outcomes[outcome].tokenId)?.bestBid ?? null;
  const proceeds = sellProceeds(shares ?? 0, bestBid, market.tickSize);
  const problem = text === "" ? null : shares === null ? (Number(text) > held ? `You hold ${formatToken(held)} ${name} shares.` : "Enter a number of shares.")
    : bestBid === null ? "No one is buying this outcome right now." : null;
  const closed = market.closed || !market.acceptingOrders;

  async function sell() {
    if (shares === null || problem) return;
    start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Sell your shares" }]);
    try {
      const request = await api<SignRequest>("/api/predictions/orders/sell", { method: "POST", json: { marketId: market.id, outcome, shares } });
      const authorization = await wallet.authorize(request.request);
      at("send");
      const result = await api<SignedOrder>("/api/predictions/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
      const received = Number(result.order?.takingAmount), sold = Number(result.order?.makingAmount);
      finish(Number.isFinite(received) && received > 0 && Number.isFinite(sold) && sold > 0
        ? `Sold ${formatToken(sold)} ${name} shares for ${formatUsd(received)}. It's in your predictions cash.`
        : `Sold. The money is in your predictions cash.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(predictionErrorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  if (flow) return <div className="mkOrderFlow">
    <FlowTimeline flow={flow} title="Sale progress" />
    {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => { reset(); setText(""); onDone?.(); }}>Done</button>}
  </div>;
  if (!position || held <= 0) return <p className="mxHint pdNone">You don&apos;t hold any {name} shares in this market.</p>;
  return <form className="mkSheetBody" aria-label={`Sell ${name}`} onSubmit={(event) => { event.preventDefault(); void sell(); }}>
    <div className="pdSharesField">
      <label className="mkLabelRow" htmlFor={`${idPrefix}-shares`}><span className="mkLabel">Shares</span><small>You hold {formatToken(held)}</small></label>
      <input id={`${idPrefix}-shares`} className="pdSharesInput" inputMode="decimal" autoComplete="off" placeholder="0" value={text} aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${idPrefix}-shares-error` : undefined} onChange={(event) => setText(typedDecimal(event.target.value))} />
      <div className="mkShares" role="group" aria-label="Share shortcuts">
        {([["25%", 0.25], ["50%", 0.5], ["Max", 1]] as const).map(([label, part]) =>
          <button type="button" key={label} className="mkChip" onClick={() => setText(sharesText(held * part))}>{label}</button>)}
      </div>
      {problem && <p className="mxFieldError" id={`${idPrefix}-shares-error`}>{problem}</p>}
    </div>
    <dl className="mxSummary">
      <div><dt>Price now</dt><dd>{formatCents(bestBid) ?? <span className="appUnavailable">Unavailable</span>}</dd></div>
      <div><dt>Bought at</dt><dd>{formatCents(position.avgPrice)}</dd></div>
      <div className="pdTotal"><dt>You&apos;ll receive</dt><dd data-testid="prediction-sell-receive">{proceeds ? `About ${formatUsd(proceeds.about)}` : "—"}</dd></div>
    </dl>
    {proceeds && <p className="mxHint">At least {formatUsd(proceeds.atLeast)}: the sale takes the best offers, down to 2% under the price now.</p>}
    <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={shares === null || problem !== null || closed}>Sell {name}</button>
  </form>;
}

/** Collect a resolved market's winnings into predictions cash, signed with the passkey. */
export function CollectForm({ market, position, onDone, onBusy }: { market: PolymarketMarket; position: PredictionPosition; onDone?: () => void; onBusy?: (busy: boolean) => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const { flow, start, at, finish, fail, running } = useFlow();
  useEffect(() => onBusy?.(running), [onBusy, running]);

  async function collect() {
    start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Collect your winnings" }]);
    try {
      const request = await api<SignRequest>("/api/predictions/redeem", { method: "POST", json: { marketId: market.id } });
      const authorization = await wallet.authorize(request.request);
      at("send");
      await api("/api/predictions/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
      finish(`Collecting ${formatUsd(position.value)}. It reaches your predictions cash in about a minute.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(predictionErrorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  if (flow) return <div className="mkOrderFlow">
    <FlowTimeline flow={flow} title="Collect progress" />
    {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onDone}>Done</button>}
  </div>;
  return <form className="mkSheetBody" aria-label="Collect winnings" onSubmit={(event) => { event.preventDefault(); void collect(); }}>
    <dl className="mxSummary">
      <div><dt>{position.outcome} won</dt><dd>{formatToken(position.size)} shares × $1</dd></div>
      <div className="pdTotal"><dt>You collect</dt><dd data-testid="prediction-collect-amount">{formatUsd(position.value)}</dd></div>
    </dl>
    <button type="submit" className="appButton appButtonPrimary appButtonLarge">Collect {formatUsd(position.value)}</button>
    <p className="mxHint">Winnings go to your predictions cash. Aura charges no fee.</p>
  </form>;
}

/**
 * A position's Sell or Collect, in a sheet. Given only the position (as the
 * predictions home has it), it reads the market by the position's slug first.
 */
export function PredictionPositionSheet({ position, market, quotes, mode, onClose }: {
  position: PredictionPosition; market?: PolymarketMarket; quotes?: ClobQuote[] | null; mode: "sell" | "redeem"; onClose: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const title = mode === "sell" ? `Sell ${position.outcome}` : "Collect winnings";
  const form = (loaded: PolymarketMarket, prices: ClobQuote[] | null | undefined) => mode === "sell"
    ? <SellForm market={loaded} quotes={prices} outcome={position.outcomeIndex === 1 ? 1 : 0} position={position} onDone={onClose} onBusy={setBusy} idPrefix="position-sell" />
    : <CollectForm market={loaded} position={position} onDone={onClose} onBusy={setBusy} />;
  return <Sheet onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="mkSheet" describedBy="prediction-position-title">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={busy}>Close</Dialog.Close></div>
    <p className="mxDialogNote" id="prediction-position-title">{position.title}</p>
    {market ? form(market, quotes) : <MarketBySlug slug={position.slug ?? ""}>{form}</MarketBySlug>}
  </Sheet>;
}

/** Reads a market by the slug a position names, then draws `children` with it. */
function MarketBySlug({ slug, children }: { slug: string; children: (market: PolymarketMarket, quotes: ClobQuote[] | null | undefined) => React.ReactNode }) {
  const view = usePredictionMarket(slug);
  if (view.data) return <>{children(view.data.market, view.data.quotes)}</>;
  return view.isPending ? <LoadingState label="Loading this market" />
    : <Notice tone="warning" role="alert" onRetry={() => void view.refetch()}>This market can&apos;t be loaded from Polymarket right now.</Notice>;
}

/** Finish setting up a predictions account that was started and left: each remaining step, in place. */
export function PredictionsSetupSheet({ onClose }: { onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const { flow, start, at, finish, fail, running } = useFlow();

  async function run() {
    start(SETUP_STEPS);
    try {
      await setupPredictions(api, wallet.authorize, (key, detail) => at(key, detail));
      finish("Your predictions account is ready.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(predictionErrorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet" describedBy="predictions-setup-note">
    <div className="mxDialogHead"><Dialog.Title>Finish setting up</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    <p className="mxDialogNote" id="predictions-setup-note">Your wallet owns its own Polymarket account. Setting it up takes about a minute and two passkey confirmations, once.</p>
    {flow ? <>
      <FlowTimeline flow={flow} title="Setup progress" />
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <>
      <ol className="pdSetupList">{SETUP_STEPS.map((step, index) => <li key={step.key}><span aria-hidden="true">{index + 1}</span><span><strong>{step.label}</strong><small>{step.detail}</small></span></li>)}</ol>
      <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => void run()}>Continue setup</button>
    </>}
  </Sheet>;
}

/** Deposit USDC on Base into predictions cash, or withdraw cash back there. */
export function PredictionsMoneySheet({ mode, account, onClose }: { mode: "add" | "withdraw"; account: PredictionsAccount | undefined; onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, running } = useFlow();
  const [amount, setAmount] = useState("");
  const value = parseDollars(amount);
  const cash = cashOf(account);
  const ready = account?.connection?.status === "ready";
  const available = mode === "add" ? usdc.amount : cash;
  const problem = value === null ? null : available === null ? "Your balance can't be loaded right now."
    : value > available ? `Not enough ${mode === "add" ? "USDC" : "predictions cash"}. You have ${formatUsd(available)}.` : null;

  async function submit() {
    if (value === null || problem) return;
    try {
      if (mode === "add") {
        start([...(!ready ? SETUP_STEPS : []), { key: "add", label: `Deposit ${formatUsd(value)}`, detail: "It reaches your predictions cash in a few minutes." }]);
        if (!ready) { at("create"); await setupPredictions(api, wallet.authorize, (key, detail) => at(key, detail)); }
        at("add");
        await deposit.runAndWait(() => prepareDeposit(api, value, usdc.amount));
        finish(`${formatUsd(value)} is on its way to your predictions cash. It shows in a few minutes.`);
      } else {
        start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Send it to your Aura account" }]);
        const request = await api<SignRequest>("/api/predictions/withdraw", { method: "POST", json: { amount: value.toFixed(2) } });
        const authorization = await wallet.authorize(request.request);
        at("send");
        await api("/api/predictions/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
        finish(`Withdrawal sent. ${formatUsd(value)} arrives as USDC in your Aura account on Base in a few minutes.`);
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(predictionErrorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  const title = mode === "add" ? "Deposit to predictions" : "Withdraw from predictions";
  const depositFailed = deposit.action?.status === "failed" || deposit.action?.status === "expired" || deposit.outcomeUnknown;
  const noUsdc = mode === "add" && usdc.amount === 0;
  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {/* The deposit's own card shows while it runs, or if it failed; once it's done, the timeline's result says so, once. */}
      {deposit.phase !== "idle" && (running || depositFailed) && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : mode === "withdraw" && !ready ? <>
      <p className="mxHint pdNone">There&apos;s nothing to withdraw yet. Deposit or buy first.</p>
      <button type="button" className="appButton appButtonLarge" onClick={onClose}>Close</button>
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <DollarAmount label="Amount" value={amount} onChange={(next) => setAmount(typedDecimal(next))} available={available} error={problem} />
      {mode === "add" && <PayWith amount={usdc.amount} note={!ready ? "first sets up predictions" : undefined} />}
      {noUsdc && <NoUsdc />}
      {mode === "withdraw" && <dl className="mxSummary"><div><dt>Predictions cash</dt><dd>{cash === null ? <span className="appUnavailable">Unavailable</span> : formatUsd(cash)}</dd></div>
          <div><dt>Arrives in</dt><dd>Your Aura account on Base</dd></div></dl>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={value === null || problem !== null}>{mode === "add" ? "Deposit" : "Withdraw"}</button>
      <p className="mxHint">Polymarket moves your USDC between Base and your predictions cash in a few minutes. Aura charges no fee.</p>
    </form>}
  </Sheet>;
}
