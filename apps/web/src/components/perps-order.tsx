"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuth } from "@/lib/client/auth";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import { formatToken, formatUsd } from "@/lib/format";
import {
  addableFromBase, availableToTrade, cleanDecimal, cleanWhole, clampLeverage, formatFee, formatPrice, formatSignedUsd, maxOrderMargin, parseDollars, parsePrice,
  perpName, perpsTopUp, pnlAt, PERPS_MINIMUM_DEPOSIT, triggerProblem
} from "@/lib/markets/view";
import { perpsPositions, perpsTotals, useBaseUsdc, type PerpMarket, type PerpsAccount } from "./markets-data";
import { DollarAmount, failureMessage, FlowTimeline, PayWith, Segmented, useFlow, useSettledAction, type FlowStep } from "./markets-parts";
import { ADD_MONEY_DETAIL, addToPerps, connectPerps, depositFee, feeText, orderError, PriceField, usePerpsAction, type ExchangeStatus } from "./perps-sheets";
import { Sheet } from "./sheet";
import { TransactionProgress } from "./transaction-progress";

type Side = "long" | "short";
type Preview = { price: string; size: string; notional: string; margin: string; liquidationPrice: string | null; coin: string; maxLeverage: number;
  /** Estimated taker fee in dollars, and its rate; null when Hyperliquid didn't answer the fee read. */
  fee?: string | null; feeRate?: string | null };

/** A book price as the limit field holds it: Hyperliquid's "64251.0" is "64251". */
const bookPrice = (price: string) => { const clean = cleanDecimal(price); return clean.includes(".") ? clean.replace(/\.?0+$/, "") : clean; };

/** A price picked from the order book: a limit order at that price, on the side that would trade with it. `nonce` makes a repeat pick count. */
export type OrderPreset = { price: string; side: Side; nonce: number };

/**
 * What one market can trade with now: what's available to trade in its own
 * account (dex), plus, for a stock market, what can be withdrawn from the main
 * account, which Aura moves across before the order. Null while it can't be read.
 */
export function availableFor(account: PerpsAccount | undefined, dex: string): number | null {
  if (!account || account.dexStates.status !== "observed") return null;
  const states = account.dexStates.data;
  const own = states.find((item) => item.dex === dex);
  const here = own ? availableToTrade(own) : 0;
  if (!dex) return here;
  return Math.floor((here + Math.max(0, Number(states.find((item) => item.dex === "")?.withdrawable ?? 0))) * 100) / 100;
}

/**
 * The order form: Market or Limit, Cross or Isolated, Long or Short, a dollar
 * amount, leverage (the market's maximum unless a position already set it),
 * an optional take profit and stop loss, the server's estimate of size, fee,
 * and liquidation, and one button that does everything still needed. If the
 * perps balance is short, USDC comes from the Aura account first (the app's
 * own action flow), then the wallet is connected once with the passkey, then
 * the order is placed. The steps show in place.
 *
 * On desktop it's the market page's order panel, with a Long/Short toggle;
 * on the phone it's inside the order sheet, whose title names the side.
 */
export function PerpsOrderForm({ market, side, onSide, account, variant, onDone, onRunning, preset }: {
  market: PerpMarket; side: Side; onSide?: (side: Side) => void; account: PerpsAccount | undefined;
  variant: "panel" | "sheet"; onDone: () => void; onRunning?: (running: boolean) => void; preset?: OrderPreset | null;
}) {
  const api = useApi();
  const wallet = useAuraWallet();
  const perpsAction = usePerpsAction();
  const { ready: authReady, authenticated, login } = useAuth();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, reset, running } = useFlow();
  const position = perpsPositions(account)?.find((item) => item.coin === market.coin) ?? null;
  const [amount, setAmount] = useState("");
  const [isCross, setIsCross] = useState(position ? position.leverage.type === "cross" : !market.onlyIsolated);
  const [type, setType] = useState<"market" | "limit">(preset ? "limit" : "market");
  const [limitPrice, setLimitPrice] = useState(preset ? bookPrice(preset.price) : "");
  const [leverage, setLeverage] = useState(position?.leverage.value ?? market.maxLeverage);
  const [leverageText, setLeverageText] = useState(String(position?.leverage.value ?? market.maxLeverage));
  const [tpsl, setTpsl] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const name = perpName(market.coin);
  const guest = !authReady || !authenticated;

  // An open position sets this market's leverage and margin mode on Hyperliquid; follow it until the customer picks.
  const picked = useRef(false);
  const positionLeverage = position?.leverage.value, positionMode = position?.leverage.type;
  useEffect(() => {
    if (picked.current || positionLeverage === undefined) return;
    setLeverage(positionLeverage); setLeverageText(String(positionLeverage)); setIsCross(positionMode === "cross");
  }, [positionLeverage, positionMode]);

  // A price picked from the order book: a limit order there, on its side.
  const presetNonce = preset?.nonce;
  const presetRef = useRef(preset);
  useEffect(() => { presetRef.current = preset; }, [preset]);
  useEffect(() => {
    const picked = presetRef.current;
    if (presetNonce === undefined || !picked) return;
    setType("limit"); setLimitPrice(bookPrice(picked.price));
    onSide?.(picked.side);
  }, [presetNonce, onSide]);

  const chooseLeverage = (value: number) => { picked.current = true; setLeverage(value); setLeverageText(String(value)); };
  const margin = parseDollars(amount);
  const tradable = availableFor(account, market.dex);
  const base = usdc.amount;
  const max = maxOrderMargin(tradable, base);
  const fromBase = addableFromBase(base);
  const short = margin !== null && tradable !== null ? Math.max(0, margin - tradable) : 0;
  const topUp = short > 0 && base !== null ? Math.min(perpsTopUp(short), Math.floor(base * 100) / 100) : 0;
  const limit = type === "limit" ? parsePrice(limitPrice) : null;
  const reference = type === "limit" ? (limit ? Number(limit) : null) : Number(market.midPx ?? market.markPx);
  const tp = tpsl ? parsePrice(takeProfit) : null, sl = tpsl ? parsePrice(stopLoss) : null;
  const tpProblem = triggerProblem("tp", side, tp ? Number(tp) : null, reference);
  const slProblem = triggerProblem("sl", side, sl ? Number(sl) : null, reference);
  const body = margin === null ? null : {
    coin: market.coin, side, marginUsd: margin.toFixed(2), leverage, isCross, type, ...(limit ? { limitPrice: limit } : {}),
    ...(tp ? { takeProfit: { triggerPrice: tp } } : {}), ...(sl ? { stopLoss: { triggerPrice: sl } } : {})
  };

  const problem = margin === null || guest ? null
    : tradable === null ? "Your perps balance can't be read right now."
      : margin * leverage < 10 ? "Orders must be worth at least $10. Add more or raise the leverage."
        : short > 0 && base === null ? "Your USDC balance can't be read right now."
          : max !== null && margin > max ? `That's more than you have. You can put in up to ${formatUsd(max)}.`
            : short > 0 && (topUp < short || topUp < PERPS_MINIMUM_DEPOSIT) ? `You don't have enough USDC. Adding money to perps takes at least $${PERPS_MINIMUM_DEPOSIT}.`
              : type === "limit" && !limit ? "Enter the limit price." : null;
  const blocked = problem !== null || tpProblem !== null || slProblem !== null;

  const preview = useQuery({
    queryKey: ["perps-preview", JSON.stringify(body)],
    queryFn: () => api<Preview>("/api/perps/trade/preview", { method: "POST", json: body }),
    enabled: body !== null && !blocked && !flow && !guest,
    retry: false,
    staleTime: 5_000
  });

  async function place() {
    if (!body || blocked) return;
    const ready = account?.connection?.status === "ready";
    const steps: FlowStep[] = [
      ...(topUp > 0 ? [{ key: "add", label: "Adding money…", detail: `${formatUsd(topUp)} from your USDC on Base. ${ADD_MONEY_DETAIL}` }] : []),
      ...(!ready ? [{ key: "setup", label: "Connecting your wallet", detail: "Confirm with your passkey. You do this once." }] : []),
      { key: "order", label: "Placing your order" }
    ];
    start(steps);
    try {
      if (topUp > 0) {
        at("add");
        await addToPerps({ api, deposit, amount: topUp, baseline: perpsTotals(account)?.value ?? null,
          onPrepared: (action) => { const fee = depositFee(action); if (fee !== null) at("add", `${formatUsd(topUp)} from your USDC on Base. ${ADD_MONEY_DETAIL} ${feeText(fee)}.`); },
          onSlow: () => at("add", "This is taking longer than usual. The money is on its way; your order is placed as soon as it lands.") });
        await queryClient.invalidateQueries({ queryKey: ["perps-account"] });
      }
      if (!ready) { at("setup"); await connectPerps(api, wallet.authorize, account?.owner ?? wallet.address); }
      at("order");
      const result = await perpsAction<{ statuses: ExchangeStatus[]; size: string; notional: string }>("/api/perps/trade", body);
      const refused = orderError(result.statuses);
      if (refused) throw new Error(`Hyperliquid didn't place it: ${refused}`);
      const filled = result.statuses.find((status) => status.kind === "filled");
      finish(filled && filled.kind === "filled" ? `Order placed. ${formatToken(filled.totalSz, name)} at ${formatPrice(filled.avgPx)}.`
        : `Limit order placed. It waits on Hyperliquid until ${name} reaches ${formatPrice(limit)}.`);
      setAmount("");
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  useEffect(() => { onRunning?.(running); }, [running, onRunning]);

  const sideLabel = side === "long" ? "Long" : "Short";
  const depositFailed = deposit.action?.status === "failed" || deposit.action?.status === "expired" || deposit.outcomeUnknown;
  if (flow) return <div className="mkOrderFlow">
    <FlowTimeline flow={flow} title={`${sideLabel} ${name} progress`} />
    {deposit.phase !== "idle" && (running || depositFailed) && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
    {running && variant === "sheet" && topUp > 0 && <p className="mxHint">If you close this now, money being added still arrives in perps, but the order isn&apos;t placed.</p>}
    {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={() => { reset(); if (variant === "sheet") onDone(); }}>Done</button>}
  </div>;

  const size = preview.data ? Number(preview.data.size) : null;
  const entry = preview.data ? Number(preview.data.price) : reference;
  const outcome = (price: string | null) => {
    const pnl = price && size && entry ? pnlAt(side, size, entry, Number(price)) : null;
    return pnl === null ? undefined : `${pnl >= 0 ? "Profit" : "Loss"} of about ${formatSignedUsd(pnl).replace(/^[+−]/, "")}`;
  };
  const fee = preview.data ? preview.data.fee === null || preview.data.fee === undefined ? <span className="appUnavailable">Unavailable</span> : formatFee(preview.data.fee) : "—";
  const action = guest ? "Sign in to trade" : topUp > 0 ? `Add money and ${side}` : `${sideLabel} ${name}`;
  return <form className="mkOrderForm" aria-label={`${sideLabel} ${name} order`} onSubmit={(event) => { event.preventDefault(); if (guest) login(); else void place(); }}>
    <div className="mkOrderTop">
      <Segmented label="Order type" value={type} onChange={setType} options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]} />
      <label className="mkSelect"><span className="srOnly">Margin mode</span>
        <select value={isCross ? "cross" : "isolated"} onChange={(event) => { picked.current = true; setIsCross(event.target.value === "cross"); }}>
          <option value="cross" disabled={market.onlyIsolated}>Cross</option>
          <option value="isolated">Isolated</option>
        </select><ChevronDown aria-hidden="true" /></label>
    </div>
    {variant === "panel" && onSide && <Segmented label="Side" value={side} onChange={onSide} className="mkSides"
      options={[{ value: "long", label: "Long" }, { value: "short", label: "Short" }]} />}
    {variant === "sheet" && <p className="mxDialogNote" id="perps-order-note">{side === "long" ? `Gains if ${name} rises.` : `Gains if ${name} falls.`} Up to {market.maxLeverage}x leverage.</p>}
    {type === "limit" && <PriceField label="Limit price" value={limitPrice} onChange={setLimitPrice} placeholder={formatPrice(market.midPx ?? market.markPx)?.replace("$", "") ?? ""}
      action={market.midPx ? { label: "Mid", onClick: () => setLimitPrice(cleanDecimal(market.midPx!)) } : undefined}
      hint={side === "long" ? "Buys only at this price or lower." : "Sells only at this price or higher."} />}
    <DollarAmount label="Amount (USD)" value={amount} onChange={setAmount} available={max} error={problem} shares={[0.25, 0.5, 0.75]}
      aside={tradable === null ? undefined : <span data-testid="perps-order-available">{formatUsd(tradable)} to trade</span>}
      note={guest || tradable === null ? undefined : <span data-testid="perps-order-from-base">{fromBase > 0
        ? `Plus ${formatUsd(fromBase)} of your USDC on Base, added first when you need it. Max counts both.`
        : base !== null && base > 0 ? `Your ${formatUsd(base)} USDC on Base is under the $${PERPS_MINIMUM_DEPOSIT} needed to add money to perps.` : "Add USDC to your Aura account to trade more."}</span>} />
    {variant === "sheet" && <PayWith amount={base} note={tradable !== null ? `${formatUsd(tradable)} to trade in perps` : undefined} />}
    <div className="mkLeverage">
      <span className="mkLabelRow"><span className="mkLabel" id={`leverage-${market.assetIndex}`}>Leverage</span>
        <label className="mkLeverageBox"><span className="srOnly">Leverage, times</span>
          <input type="text" role="spinbutton" inputMode="numeric" aria-valuemin={1} aria-valuemax={market.maxLeverage} aria-valuenow={leverage} value={leverageText}
            onChange={(event) => { const text = cleanWhole(event.target.value, market.maxLeverage); setLeverageText(text); picked.current = true;
              if (text !== "") setLeverage(clampLeverage(Number(text), market.maxLeverage)); }}
            onKeyDown={(event) => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault();
              chooseLeverage(clampLeverage(leverage + (event.key === "ArrowUp" ? 1 : -1), market.maxLeverage)); } }}
            onBlur={() => setLeverageText(String(leverage))} /><span aria-hidden="true">x</span></label></span>
      <input type="range" min={1} max={market.maxLeverage} step={1} value={leverage} aria-labelledby={`leverage-${market.assetIndex}`} aria-valuetext={`${leverage}x`}
        onChange={(event) => chooseLeverage(Number(event.target.value))} />
      <span className="mkLeverageEnds" aria-hidden="true"><span>1x</span><span>{market.maxLeverage}x</span></span>
      <small className="mkFieldHint">{position ? `Your open ${name} position uses ${position.leverage.value}x ${position.leverage.type}. A change applies to it too. `
        : ""}{isCross ? "Cross: your whole perps balance backs the position." : "Isolated: only this position's margin is at risk."}</small>
    </div>
    <label className="mkSwitchRow"><span><strong>Take profit / Stop loss</strong><small>Close automatically at a profit or a loss you choose.</small></span>
      <input type="checkbox" className="appSwitch" checked={tpsl} onChange={(event) => setTpsl(event.target.checked)} /></label>
    {tpsl && <div className="mxFieldRow">
      <PriceField label="Take profit at" value={takeProfit} onChange={setTakeProfit} error={tpProblem} hint={outcome(tp)} />
      <PriceField label="Stop loss at" value={stopLoss} onChange={setStopLoss} error={slProblem} hint={outcome(sl)} />
    </div>}
    <dl className="mxSummary">
      <div><dt>Position size</dt><dd>{preview.data ? `${formatUsd(preview.data.notional)} · ${formatToken(preview.data.size, name)}` : "—"}</dd></div>
      <div><dt>Margin</dt><dd>{preview.data ? formatUsd(preview.data.margin) : margin !== null ? formatUsd(margin) : "—"}</dd></div>
      <div><dt>Estimated fee</dt><dd data-testid="perps-fee">{preview.isError ? <span className="appUnavailable">Unavailable</span> : fee}</dd></div>
      <div><dt>Liquidation price</dt><dd data-testid="perps-liquidation">{preview.isError ? <span className="appUnavailable">Unavailable</span>
        : preview.data ? formatPrice(preview.data.liquidationPrice) ?? "None at this leverage" : "—"}</dd></div>
      {topUp > 0 && <div><dt>Added from USDC first</dt><dd>{formatUsd(topUp)}</dd></div>}
    </dl>
    {preview.isError && <p className="mxFieldError" role="alert">{failureMessage(preview.error)}</p>}
    <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={!guest && (margin === null || blocked)}>{action}</button>
    <p className="mxHint">If the price reaches the liquidation price, Hyperliquid closes the position and the margin is lost. Hyperliquid charges the fee; Aura charges none.</p>
  </form>;
}

/** The order form in a sheet, for the phone: Long, Short, or a price in the book opens it. It can always be closed. */
export function PerpsOrderSheet({ market, side, account, preset, onClose }: { market: PerpMarket; side: Side; account: PerpsAccount | undefined;
  preset?: OrderPreset | null; onClose: () => void }) {
  const title = `${side === "long" ? "Long" : "Short"} ${perpName(market.coin)}`;
  return <Sheet onOpenChange={(open) => { if (!open) onClose(); }} className="mkSheet" describedBy="perps-order-note">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
    <PerpsOrderForm market={market} side={side} account={account} variant="sheet" onDone={onClose} preset={preset} />
  </Sheet>;
}
