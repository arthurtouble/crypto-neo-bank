"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { Delete } from "lucide-react";
import { useEffect, useId, useState } from "react";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { formatToken, formatUsd } from "@/lib/format";
import { formatCents, parseDollars, payoutIfWins, pressKey } from "@/lib/markets/view";
import { addDollars, QUICK_ADDS, typedDecimal, winningOutcome } from "@/lib/markets/predictions-view";
import { buyPrice, useBaseUsdc, type ClobQuote, type PolymarketMarket, type PredictionPosition, type PredictionsAccount } from "./markets-data";
import { FlowTimeline, Segmented, useFlow, useIsPhone, useSettledAction, type FlowStep } from "./markets-parts";
import { predictionErrorMessage } from "./predictions-data";
import { cashOf, prepareDeposit, SellForm, SETUP_STEPS, setupPredictions, waitForCredit, type SignedOrder, type SignRequest } from "./prediction-sheets";
import { Sheet } from "./sheet";
import { TransactionProgress } from "./transaction-progress";

export type TradeSide = "buy" | "sell";
type Quote = { amount: number; estimatedShares: number; payoutIfWins: number };

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", ".", "0", "delete"];

/** The best price buyers offer for an outcome now, or null. */
const bidOf = (market: PolymarketMarket, quotes: ClobQuote[] | null | undefined, outcome: 0 | 1) =>
  quotes?.find((item) => item.tokenId === market.outcomes[outcome].tokenId)?.bestBid ?? null;

/** Yes or No (Up or Down) as two large choices with their price in cents: what a share costs to buy, or what it sells for. */
function OutcomePick({ market, quotes, outcome, onOutcome, side }: { market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; outcome: 0 | 1; onOutcome: (next: 0 | 1) => void; side: TradeSide }) {
  return <div className="pdPick" role="radiogroup" aria-label="Outcome">
    {([0, 1] as const).map((index) => {
      const price = side === "buy" ? buyPrice(market, quotes, index) : bidOf(market, quotes, index);
      return <button type="button" role="radio" key={index} aria-checked={outcome === index} className={index === 0 ? "is-first" : "is-second"} onClick={() => onOutcome(index)}>
        {market.outcomes[index].name} <span>{formatCents(price) ?? "—"}</span></button>;
    })}
  </div>;
}

/**
 * A buy's dollar amount, as Polymarket takes it: the amount with quick adds
 * of $1, $20, and $100 and Max. On the phone the amount is large and centred,
 * and a keypad enters it so the system keyboard stays closed.
 */
function BuyAmount({ value, onChange, max, error }: { value: string; onChange: (value: string) => void; max: number | null; error: string | null }) {
  const phone = useIsPhone();
  const id = useId();
  return <div className="pdAmount">
    <label className="pdAmountField" htmlFor={id}>
      <span className="mkLabel">Amount</span>
      <span className={`pdAmountInput${value ? "" : " is-empty"}`}><span aria-hidden="true">$</span>
        <input id={id} value={value} style={{ width: `${Math.max(1, value.length) + 0.25}ch` }} inputMode={phone ? "none" : "decimal"} autoComplete="off" placeholder="0" aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined} onChange={(event) => onChange(typedDecimal(event.target.value))} /></span>
    </label>
    <div className="mkShares pdQuickAdds" role="group" aria-label="Amount shortcuts">
      {QUICK_ADDS.map((add) => <button type="button" key={add} className="mkChip" onClick={() => onChange(addDollars(value, add))}>+${add}</button>)}
      <button type="button" className="mkChip" disabled={!max || max < 1} onClick={() => onChange(String(Math.floor((max ?? 0) * 100) / 100))}>Max</button>
    </div>
    {error && <p className="mxFieldError" id={`${id}-error`}>{error}</p>}
    {phone && <div className="mkKeypad" role="group" aria-label="Keypad">
      {KEYS.map((key) => <button type="button" key={key} aria-label={key === "delete" ? "Delete" : key} onClick={() => onChange(pressKey(value, key))}>
        {key === "delete" ? <Delete aria-hidden="true" /> : key}</button>)}
    </div>}
  </div>;
}

/**
 * Buy an outcome with dollars. Runs every step the customer still needs, in
 * place: sets up the predictions account, adds money from USDC on Base when
 * predictions cash is short, then prices the buy against the order book and
 * asks the passkey to sign it.
 */
function BuyForm({ market, quotes, outcome, account, guest, onSignIn, onDone, onBusy }: {
  market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; outcome: 0 | 1; account: PredictionsAccount | undefined;
  guest: boolean; onSignIn: () => void; onDone?: () => void; onBusy?: (busy: boolean) => void;
}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, reset, running } = useFlow();
  const [amount, setAmount] = useState("");
  const [quote, setQuote] = useState<Quote | null>(null);
  useEffect(() => onBusy?.(running), [onBusy, running]);
  const value = parseDollars(amount);
  const price = buyPrice(market, quotes, outcome);
  const cash = cashOf(account);
  const ready = account?.connection?.status === "ready";
  const short = value !== null ? Math.max(0, Math.round((value - (cash ?? 0)) * 100) / 100) : 0;
  const max = guest ? null : (cash ?? 0) + (usdc.amount ?? 0);
  const toWin = value !== null ? payoutIfWins(value, price) : null;
  const name = market.outcomes[outcome].name;
  const problem = value === null ? null : value < 1 ? "The smallest buy is $1."
    : price === null ? "There's no price for this outcome right now."
      : guest ? null
        : account && account.balance.status !== "observed" && ready ? "Your predictions cash can't be read right now."
          : short > 0 && usdc.amount === null ? "Your USDC balance can't be read right now."
            : short > 0 && short > (usdc.amount ?? 0) ? `That's more than you have. You can spend up to ${formatUsd(max ?? 0)}.` : null;

  async function buy() {
    if (guest) { onSignIn(); return; }
    if (value === null || problem) return;
    const steps: FlowStep[] = [
      ...(!ready ? SETUP_STEPS : []),
      ...(short > 0 ? [{ key: "add", label: `Add ${formatUsd(short)} from your USDC` }] : []),
      { key: "buy", label: "Confirm with your passkey" },
      { key: "send", label: "Placing your order…" }
    ];
    start(steps);
    try {
      if (!ready) { at("create"); await setupPredictions(api, wallet.authorize, (key, detail) => at(key, detail)); }
      if (short > 0) {
        at("add");
        await deposit.runAndWait(() => prepareDeposit(api, short, usdc.amount));
        at("add", "Waiting for Polymarket to credit it…");
        await waitForCredit(api, value);
      }
      at("buy");
      const order = await api<SignRequest & { quote: Quote }>("/api/predictions/orders/buy", { method: "POST", json: { marketId: market.id, outcome, amountUsd: value } });
      setQuote(order.quote);
      at("buy", `${formatUsd(order.quote.amount)} for about ${formatToken(order.quote.estimatedShares)} ${name} shares.`);
      const authorization = await wallet.authorize(order.request);
      at("send");
      const result = await api<SignedOrder>("/api/predictions/signatures", { method: "POST", json: { requestId: order.requestId, authorization } });
      const spent = Number(result.order?.makingAmount), got = Number(result.order?.takingAmount);
      if (result.order?.status === "matched" && spent > 0 && got > 0) setQuote({ amount: spent, estimatedShares: got, payoutIfWins: got });
      finish(result.order?.status === "delayed" ? "Order sent. Polymarket is matching it; it shows in your positions in a few seconds."
        : result.order?.status === "live" ? "Order placed. It waits on Polymarket until someone sells at your price."
          : spent > 0 && got > 0 ? `Order placed. You bought ${formatToken(got)} ${name} shares for ${formatUsd(spent)}.` : `Order placed. You bought ${name}.`);
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(predictionErrorMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["predictions-account"] });
    }
  }

  if (flow) return <div className="mkOrderFlow">
    <FlowTimeline flow={flow} title="Buy progress" />
    {deposit.phase !== "idle" && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
    {quote && flow.done && <dl className="mxSummary"><div><dt>Shares</dt><dd>{formatToken(quote.estimatedShares)}</dd></div>
      <div><dt>If {name} wins</dt><dd>{formatUsd(quote.payoutIfWins)}</dd></div></dl>}
    {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => { reset(); setAmount(""); setQuote(null); onDone?.(); }}>Done</button>}
  </div>;

  return <form className="mkSheetBody" aria-label={`Buy ${name}`} onSubmit={(event) => { event.preventDefault(); void buy(); }}>
    <BuyAmount value={amount} onChange={setAmount} max={max} error={problem} />
    <dl className="mxSummary">
      <div><dt>Price</dt><dd>{formatCents(price) ?? <span className="appUnavailable">Unavailable</span>}</dd></div>
      <div><dt>Shares</dt><dd>{toWin !== null ? `About ${formatToken(Math.floor(toWin * 100) / 100)}` : "—"}</dd></div>
      {!guest && <div><dt>Pay from</dt><dd>{short > 0 ? `${formatUsd(short)} from your USDC, then cash` : "Predictions cash"}</dd></div>}
    </dl>
    <p className="pdToWin" data-testid="prediction-payout"><span>To win</span><strong>{toWin !== null ? formatUsd(toWin) : "$0.00"}</strong></p>
    {!guest && !ready && <p className="mxHint">Your first buy sets up your predictions account: about a minute and two passkey confirmations, once.</p>}
    <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={!guest && (value === null || problem !== null)}>{guest ? "Sign in to trade" : `Buy ${name}`}</button>
    <p className="mxHint">If {name} wins, each share pays $1. The price can move before your order fills. Aura charges no fee.</p>
  </form>;
}

/**
 * The order form for one market, as Polymarket lays it out: Buy or Sell,
 * the outcome with its price, then the amount (dollars to buy, shares to
 * sell) and what it comes to. The market page shows it as a panel beside the
 * chart on desktop and in a sheet on the phone.
 */
export function PredictionTradeForm({ market, quotes, account, outcome, onOutcome, side, onSide, held, guest, onSignIn, onDone, onBusy }: {
  market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; account: PredictionsAccount | undefined;
  outcome: 0 | 1; onOutcome: (next: 0 | 1) => void; side: TradeSide; onSide: (next: TradeSide) => void;
  /** The customer's positions in this market, or null when they can't be read. */
  held: PredictionPosition[] | null; guest: boolean; onSignIn: () => void; onDone?: () => void;
  /** Told while a trade's steps run, so a sheet can't be closed mid-way. */
  onBusy?: (busy: boolean) => void;
}) {
  const winner = winningOutcome(market);
  if (market.closed || !market.acceptingOrders) return <div className="pdEnded" data-testid="prediction-trading-ended">
    <strong>{market.closed ? "This market has ended" : "Trading has ended"}</strong>
    <p className="mxHint">{winner !== null ? `${market.outcomes[winner].name} won. Winning shares pay $1 each; collect yours from Your position.`
      : market.closed ? "Polymarket is deciding the result." : "This market isn't taking orders. Polymarket decides the result after it ends."}</p>
  </div>;
  const position = held?.find((item) => (item.outcomeIndex === 1 ? 1 : 0) === outcome) ?? null;
  return <div className="pdTradeForm">
    <Segmented label="Buy or sell" value={side} onChange={onSide} className="pdSides" options={[{ value: "buy", label: "Buy" }, { value: "sell", label: "Sell" }]} />
    <OutcomePick market={market} quotes={quotes} outcome={outcome} onOutcome={onOutcome} side={side} />
    {side === "buy"
      ? <BuyForm key={`${market.id}-${outcome}`} market={market} quotes={quotes} outcome={outcome} account={account} guest={guest} onSignIn={onSignIn} onDone={onDone} onBusy={onBusy} />
      : guest ? <><p className="mxHint pdNone">Sign in to sell shares you hold.</p><button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onSignIn}>Sign in to trade</button></>
        : held === null ? <p className="mxHint pdNone"><span className="appUnavailable">Unavailable.</span> We couldn&apos;t read your positions from Polymarket.</p>
          : <SellForm key={`${market.id}-${outcome}`} market={market} quotes={quotes} outcome={outcome} position={position} onDone={onDone} onBusy={onBusy} idPrefix="panel-sell" />}
  </div>;
}

/** The order form in a bottom sheet, for the phone: opened by Buy Yes or Buy No under the chart. */
export function PredictionTradeSheet({ market, quotes, account, initialOutcome, initialSide = "buy", held, onClose }: {
  market: PolymarketMarket; quotes: ClobQuote[] | null | undefined; account: PredictionsAccount | undefined;
  initialOutcome: 0 | 1; initialSide?: TradeSide; held: PredictionPosition[] | null; onClose: () => void;
}) {
  const [outcome, setOutcome] = useState(initialOutcome);
  const [side, setSide] = useState<TradeSide>(initialSide);
  const [busy, setBusy] = useState(false);
  return <Sheet onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="mkSheet pdSheet" describedBy="prediction-question">
    <div className="mxDialogHead"><Dialog.Title>{side === "buy" ? "Buy" : "Sell"}</Dialog.Title><Dialog.Close className="appTextButton" disabled={busy}>Close</Dialog.Close></div>
    <p className="mxDialogNote" id="prediction-question">{market.question}</p>
    <PredictionTradeForm market={market} quotes={quotes} account={account} outcome={outcome} onOutcome={setOutcome} side={side} onSide={setSide}
      held={held} guest={false} onSignIn={onClose} onDone={onClose} onBusy={setBusy} />
  </Sheet>;
}
