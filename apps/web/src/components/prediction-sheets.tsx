"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import type { ActionView } from "@/lib/client/use-action";
import { formatToken, formatUsd } from "@/lib/format";
import { formatCents, parseDollars, payoutIfWins } from "@/lib/markets/view";
import { buyPrice, useBaseUsdc, type ClobQuote, type PolymarketMarket, type PredictionPosition, type PredictionsAccount } from "./markets-data";
import { DollarAmount, failureMessage, FlowTimeline, PayWith, Segmented, sleep, useFlow, useSettledAction, type FlowStep } from "./markets-parts";
import { Sheet } from "./sheet";
import { TransactionProgress } from "./transaction-progress";

type Api = ReturnType<typeof useApi>;
type Authorize = (request: AuthorizationRequest<unknown>) => Promise<string>;
type SignRequest = { requestId: string; request: AuthorizationRequest<unknown> };
type Setup = { status: "ready"; wallet: string } | { status: "waiting"; wallet: string; transactionId: string } | ({ status: "sign" } & SignRequest);

/** Seconds between setup checks while Polygon confirms the wallet's deployment or approvals. */
const SETUP_POLL_MS = 3_000;
const SETUP_MAX_STEPS = 60;
/** How long to wait for Polymarket's bridge to credit a deposit before saying so. */
const CREDIT_WAIT_MS = 4 * 60_000;

/**
 * Connect the wallet to Polymarket one step at a time, until ready: wait while
 * Polygon confirms, and sign each approval or sign-in with the passkey.
 */
async function setupPredictions(api: Api, authorize: Authorize, onStep: (detail: string) => void) {
  for (let step = 0; step < SETUP_MAX_STEPS; step += 1) {
    const setup = await api<Setup>("/api/predictions/setup", { method: "POST" });
    if (setup.status === "ready") return;
    if (setup.status === "waiting") { onStep("Waiting for Polygon to confirm your wallet…"); await sleep(SETUP_POLL_MS); continue; }
    onStep("Confirm with your passkey.");
    const authorization = await authorize(setup.request);
    await api("/api/predictions/signatures", { method: "POST", json: { requestId: setup.requestId, authorization } });
    onStep("Setting up your predictions account…");
  }
  throw new Error("Setting up is taking longer than usual. Try again in a few minutes.");
}

/** Ask for a deposit; if Polymarket's bridge needs more than the shortfall, ask again for its minimum when the USDC is there. */
async function prepareDeposit(api: Api, amount: number, usdc: number | null): Promise<ActionView> {
  const request = (value: number) => api<{ action: ActionView }>("/api/predictions/deposit", { method: "POST", json: { amount: value.toFixed(2) } });
  try { return (await request(amount)).action; }
  catch (error) {
    const minimum = error instanceof ApiError && error.code === "amount_too_small" ? Number(/at least ([\d.]+)/.exec(error.message)?.[1]) : NaN;
    if (Number.isFinite(minimum) && minimum > amount && usdc !== null && minimum <= usdc) return (await request(Math.ceil(minimum * 100) / 100)).action;
    throw error;
  }
}

/** Polymarket credits a Base deposit as pUSD after it arrives; wait until the balance covers `needed`. */
async function waitForCredit(api: Api, needed: number) {
  const until = Date.now() + CREDIT_WAIT_MS;
  while (Date.now() < until) {
    const account = await api<PredictionsAccount>("/api/predictions/account").catch(() => null);
    if (account?.balance.status === "observed" && Number(account.balance.data.amount) >= needed) return;
    await sleep(SETUP_POLL_MS);
  }
  throw new Error("Your money is on its way, but Polymarket hasn't credited it yet. Try again in a few minutes.");
}

const balanceOf = (account: PredictionsAccount | undefined) => account?.balance.status === "observed" ? Number(account.balance.data.amount) : null;

/**
 * Buy an outcome with dollars. Sets up the Polymarket wallet if needed, adds
 * money from the Aura account if its balance is short, then prices the buy
 * against the book and asks the passkey to sign the order.
 */
export function PredictionTradeSheet({ market, quotes, initialOutcome, account, onClose }: {
  market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; initialOutcome: 0 | 1; account: PredictionsAccount | undefined; onClose: () => void;
}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, running } = useFlow();
  const [outcome, setOutcome] = useState<0 | 1>(initialOutcome);
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<{ amount: number; estimatedShares: number; payoutIfWins: number } | null>(null);
  const value = parseDollars(amount);
  const price = buyPrice(market, quotes, outcome);
  const balance = balanceOf(account);
  const ready = account?.connection?.status === "ready";
  const short = value !== null ? Math.max(0, value - (balance ?? 0)) : 0;
  const available = (balance ?? 0) + (usdc.amount ?? 0);
  const estimate = value !== null ? payoutIfWins(value, price) : null;
  const name = market.outcomes[outcome].name;
  const problem = value === null ? null : value < 1 ? "The smallest buy is $1."
    : account && account.balance.status !== "observed" && ready ? "Your predictions balance can't be read right now."
      : short > 0 && usdc.amount === null ? "Your USDC balance can't be read right now."
        : short > 0 && short > (usdc.amount ?? 0) ? "You don't have enough USDC." : !market.acceptingOrders ? "This market isn't taking orders." : null;

  async function buy() {
    if (value === null || problem) return;
    const steps: FlowStep[] = [
      ...(!ready ? [{ key: "setup", label: "Setting up predictions", detail: "Your wallet gets its own Polymarket account. You do this once." }] : []),
      ...(short > 0 ? [{ key: "add", label: "Adding money…", detail: `${formatUsd(short)} from your USDC.` }] : []),
      { key: "buy", label: "Confirm with your passkey" },
      { key: "send", label: "Placing order…" }
    ];
    start(steps);
    try {
      if (!ready) { at("setup"); await setupPredictions(api, wallet.authorize, (detail) => at("setup", detail)); }
      if (short > 0) {
        at("add");
        await deposit.runAndWait(() => prepareDeposit(api, short, usdc.amount));
        at("add", "Waiting for Polymarket to credit it…");
        await waitForCredit(api, value);
      }
      at("buy");
      const order = await api<SignRequest & { quote: { amount: number; estimatedShares: number; payoutIfWins: number } }>("/api/predictions/orders/buy",
        { method: "POST", json: { marketId: market.id, outcome, amountUsd: value } });
      setQuote(order.quote);
      at("buy", `${formatUsd(order.quote.amount)} → ${formatUsd(order.quote.payoutIfWins)} if ${name} wins.`);
      const authorization = await wallet.authorize(order.request);
      at("send");
      const result = await api<{ order?: { status: "live" | "matched" | "delayed" } }>("/api/predictions/signatures", { method: "POST", json: { requestId: order.requestId, authorization } });
      finish(result.order?.status === "live" ? "Order placed. It waits on Polymarket until someone sells at your price." : `Order placed. You bought ${name}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet" describedBy="prediction-question">
    <div className="mxDialogHead"><Dialog.Title>Buy</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    <p className="mxDialogNote" id="prediction-question">{market.question}</p>
    {flow ? <>
      <FlowTimeline flow={flow} title="Buy progress" />
      {deposit.phase !== "idle" && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {quote && flow.done && <dl className="mxSummary"><div><dt>Shares</dt><dd>{formatToken(quote.estimatedShares)}</dd></div>
        <div><dt>If {name} wins</dt><dd>{formatUsd(quote.payoutIfWins)}</dd></div></dl>}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={`Buy ${name}`} onSubmit={(event) => { event.preventDefault(); void buy(); }}>
      <Segmented label="Outcome" value={String(outcome) as "0" | "1"} onChange={(next) => setOutcome(Number(next) as 0 | 1)} className="mkOutcomes"
        options={[0, 1].map((index) => ({ value: String(index) as "0" | "1",
          label: <>{market.outcomes[index].name} <span>{formatCents(buyPrice(market, quotes, index as 0 | 1)) ?? "—"}</span></> }))} />
      <DollarAmount label="Amount" value={amount} onChange={setAmount} available={available > 0 ? available : null} error={problem} />
      <PayWith amount={usdc.amount} note={balance !== null && balance > 0 ? `${formatUsd(balance)} already in predictions` : undefined} />
      <p className="mkPayout" data-testid="prediction-payout">{value !== null && estimate !== null
        ? <><strong>{formatUsd(value)} → {formatUsd(estimate)}</strong> if {name} wins</> : <span>Enter an amount to see what it pays if {name} wins.</span>}</p>
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={value === null || problem !== null}>Buy {name}</button>
      <p className="mxHint">The price can move before your order fills; you see the final amount before you confirm. If {name} loses, you lose what you paid. Aura charges no fee.</p>
    </form>}
  </Sheet>;
}

/** Sell shares of a position, collect a resolved one's winnings, all signed with the passkey. */
export function PredictionPositionSheet({ market, position, mode, onClose }: { market: PolymarketMarket; position: PredictionPosition; mode: "sell" | "redeem"; onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const { flow, start, at, finish, fail, running } = useFlow();
  const [shares, setShares] = useState("");
  const count = mode === "sell" ? Number(shares) : position.size;
  const valid = mode === "redeem" || (Number.isFinite(count) && count > 0 && count <= position.size);

  async function submit() {
    if (!valid) return;
    start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: mode === "sell" ? "Selling…" : "Collecting…" }]);
    try {
      const request = mode === "sell"
        ? await api<SignRequest>("/api/predictions/orders/sell", { method: "POST", json: { marketId: market.id, outcome: position.outcomeIndex === 1 ? 1 : 0, shares: count } })
        : await api<SignRequest>("/api/predictions/redeem", { method: "POST", json: { marketId: market.id } });
      const authorization = await wallet.authorize(request.request);
      at("send");
      await api("/api/predictions/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
      finish(mode === "sell" ? "Sold. The money is in your predictions balance." : "Winnings collected. They're in your predictions balance in a minute.");
    } catch (error) {
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  const title = mode === "sell" ? `Sell ${position.outcome}` : "Collect winnings";
  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    <p className="mxDialogNote">{position.title}</p>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      {mode === "sell" && <div className="mxAmountWithMax">
        <label className="mxField">Shares<input inputMode="decimal" value={shares} onChange={(event) => setShares(event.target.value.replace(/[^\d.]/g, ""))} /></label>
        <button type="button" className="appButton mxMaxButton" onClick={() => setShares(String(position.size))}>Max</button>
      </div>}
      <dl className="mxSummary">
        <div><dt>You hold</dt><dd>{formatToken(position.size)} {position.outcome} shares</dd></div>
        <div><dt>{mode === "sell" ? "Price now" : "Pays"}</dt><dd>{mode === "sell" ? formatCents(position.currentPrice) : formatUsd(position.value)}</dd></div>
        {mode === "sell" && valid && <div><dt>About</dt><dd>{formatUsd(count * position.currentPrice)}</dd></div>}
      </dl>
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={!valid}>{mode === "sell" ? "Sell" : "Collect"}</button>
      {mode === "sell" && <p className="mxHint">Sells now at the best price buyers offer, up to 2% below it.</p>}
    </form>}
  </Sheet>;
}

/** Add money to the predictions account from USDC on Base, or withdraw it back there. */
export function PredictionsMoneySheet({ mode, account, onClose }: { mode: "add" | "withdraw"; account: PredictionsAccount | undefined; onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, running } = useFlow();
  const [amount, setAmount] = useState("");
  const value = parseDollars(amount);
  const balance = balanceOf(account);
  const ready = account?.connection?.status === "ready";
  const available = mode === "add" ? usdc.amount : balance;
  const problem = value === null ? null : available === null ? "Your balance can't be read right now." : value > available ? "That's more than you have." : null;

  async function submit() {
    if (value === null || problem) return;
    try {
      if (mode === "add") {
        start([...(!ready ? [{ key: "setup", label: "Setting up predictions" }] : []), { key: "add", label: "Adding money…", detail: "Polymarket credits it in a few minutes." }]);
        if (!ready) { at("setup"); await setupPredictions(api, wallet.authorize, (detail) => at("setup", detail)); }
        at("add");
        await deposit.runAndWait(() => prepareDeposit(api, value, usdc.amount));
        finish(`${formatUsd(value)} is on its way to your predictions balance.`);
      } else {
        start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Sending to your account…" }]);
        const request = await api<SignRequest>("/api/predictions/withdraw", { method: "POST", json: { amount: value.toFixed(2) } });
        const authorization = await wallet.authorize(request.request);
        at("send");
        await api("/api/predictions/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
        finish("Withdrawal sent. It arrives as USDC in your Aura account on Base in a few minutes.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  const title = mode === "add" ? "Add money to predictions" : "Withdraw from predictions";
  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {deposit.phase !== "idle" && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <DollarAmount label="Amount" value={amount} onChange={setAmount} available={available} error={problem} />
      {mode === "add" ? <PayWith amount={usdc.amount} /> : <dl className="mxSummary"><div><dt>Available to withdraw</dt><dd>{balance === null ? <span className="appUnavailable">Unavailable</span> : formatUsd(balance)}</dd></div>
        <div><dt>Arrives in</dt><dd>Your Aura account on Base</dd></div></dl>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={value === null || problem !== null}>{mode === "add" ? "Add money" : "Withdraw"}</button>
      <p className="mxHint">Polymarket&apos;s bridge moves USDC between Base and your predictions account. Aura charges no fee.</p>
    </form>}
  </Sheet>;
}
