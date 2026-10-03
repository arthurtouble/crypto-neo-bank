"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError, useApi } from "@/lib/client/api";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import type { ActionView } from "@/lib/client/use-action";
import { formatToken, formatUsd } from "@/lib/format";
import type { PerpPosition } from "@/lib/markets/hyperliquid/info";
import { formatPrice, parseDollars, parsePrice, perpName, perpsTopUp, PERPS_MINIMUM_DEPOSIT, positionSide } from "@/lib/markets/view";
import { useBaseUsdc, type PerpMarket, type PerpsAccount } from "./markets-data";
import { DollarAmount, failureMessage, FlowTimeline, PayWith, Segmented, useFlow, useSettledAction, type FlowStep } from "./markets-parts";
import { Sheet } from "./sheet";
import { TransactionProgress } from "./transaction-progress";

type SignRequest = { requestId: string; request: AuthorizationRequest<unknown> };
type ExchangeStatus = { kind: "resting"; oid: number } | { kind: "filled"; oid: number; totalSz: string; avgPx: string } | { kind: "success" }
  | { kind: "waiting"; for: "fill" | "trigger" } | { kind: "error"; message: string };
type Preview = { price: string; size: string; notional: string; margin: string; liquidationPrice: string | null; coin: string; maxLeverage: number };

/** Hyperliquid's answer to an order: the first error, or nothing. */
const orderError = (statuses: ExchangeStatus[]) => statuses.find((status): status is Extract<ExchangeStatus, { kind: "error" }> => status.kind === "error")?.message ?? null;

/** Main-dex money plus the market's own dex, which Aura tops up from the main balance before an order there. */
function perpsAvailableFor(account: PerpsAccount | undefined, dex: string): number | null {
  if (!account || account.dexStates.status !== "observed") return null;
  const states = account.dexStates.data;
  const main = Number(states.find((item) => item.dex === "")?.withdrawable ?? 0);
  return dex ? main + Number(states.find((item) => item.dex === dex)?.withdrawable ?? 0) : main;
}

/** Connect the customer's wallet to Hyperliquid, once: approve Aura's trading key with the passkey. */
async function connectPerps(api: ReturnType<typeof useApi>, authorize: (request: AuthorizationRequest<unknown>) => Promise<string>) {
  const setup = await api<{ status: "ready" } | ({ status: "sign" } & SignRequest)>("/api/perps/setup", { method: "POST" });
  if (setup.status === "ready") return;
  const authorization = await authorize(setup.request);
  await api("/api/perps/signatures", { method: "POST", json: { requestId: setup.requestId, authorization } });
}

/**
 * Open a long or a short with a dollar amount. If the perps balance is short,
 * the USDC comes from the Aura account first (the app's own action flow),
 * then the wallet is connected once with the passkey, then the order is placed.
 */
export function PerpsOrderSheet({ market, side, account, onClose }: { market: PerpMarket; side: "long" | "short"; account: PerpsAccount | undefined; onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, running } = useFlow();
  const [amount, setAmount] = useState("");
  const [isCross, setIsCross] = useState(!market.onlyIsolated);
  const [type, setType] = useState<"market" | "limit">("market");
  const [limitPrice, setLimitPrice] = useState("");
  const [leverage, setLeverage] = useState(Math.min(5, market.maxLeverage));
  const [autoClose, setAutoClose] = useState(false);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const name = perpName(market.coin);

  const margin = parseDollars(amount);
  const perpsAvailable = perpsAvailableFor(account, market.dex);
  const base = usdc.amount;
  const short = margin !== null && perpsAvailable !== null ? Math.max(0, margin - perpsAvailable) : 0;
  const topUp = short > 0 && base !== null ? Math.min(perpsTopUp(short), Math.floor(base * 100) / 100) : 0;
  const available = perpsAvailable === null ? null : perpsAvailable + Math.max(0, (base ?? 0) - 1);
  const limit = type === "limit" ? parsePrice(limitPrice) : null;
  const trigger = (text: string) => { const price = parsePrice(text); return price ? { triggerPrice: price } : undefined; };
  const body = margin === null ? null : {
    coin: market.coin, side, marginUsd: margin.toFixed(2), leverage, isCross, type, ...(limit ? { limitPrice: limit } : {}),
    ...(autoClose && trigger(takeProfit) ? { takeProfit: trigger(takeProfit) } : {}), ...(autoClose && trigger(stopLoss) ? { stopLoss: trigger(stopLoss) } : {})
  };

  const problem = margin === null ? null
    : perpsAvailable === null ? "Your perps balance can't be read right now."
      : margin * leverage < 10 ? "Orders must be worth at least $10. Add more or raise the leverage."
        : short > 0 && base === null ? "Your USDC balance can't be read right now."
          : short > 0 && (topUp < short || topUp < PERPS_MINIMUM_DEPOSIT) ? `You don't have enough USDC. Adding money to perps takes at least $${PERPS_MINIMUM_DEPOSIT}.`
            : type === "limit" && !limit ? "Enter the price to buy or sell at." : null;

  const previewKey = JSON.stringify(body);
  const preview = useQuery({
    queryKey: ["perps-preview", previewKey],
    queryFn: () => api<Preview>("/api/perps/trade/preview", { method: "POST", json: body }),
    enabled: body !== null && problem === null && !flow,
    retry: false,
    staleTime: 5_000
  });

  async function place() {
    if (!body || problem) return;
    const ready = account?.connection?.status === "ready";
    const steps: FlowStep[] = [
      ...(topUp > 0 ? [{ key: "add", label: "Adding money…", detail: `${formatUsd(topUp)} from your USDC. Circle's fee comes out of it.` }] : []),
      ...(!ready ? [{ key: "setup", label: "Connecting your wallet", detail: "Confirm with your passkey. You do this once." }] : []),
      { key: "order", label: "Placing order…" }
    ];
    start(steps);
    try {
      if (topUp > 0) {
        at("add");
        await deposit.runAndWait(async () => (await api<{ action: ActionView }>("/api/perps/deposit", { method: "POST", json: { amount: topUp.toFixed(2) } })).action);
        await queryClient.invalidateQueries({ queryKey: ["perps-account"] });
      }
      if (!ready) { at("setup"); await connectPerps(api, wallet.authorize); }
      at("order");
      const result = await api<{ statuses: ExchangeStatus[]; size: string; notional: string }>("/api/perps/trade", { method: "POST", json: body });
      const refused = orderError(result.statuses);
      if (refused) throw new Error(`Hyperliquid didn't place it: ${refused}`);
      const filled = result.statuses.find((status) => status.kind === "filled");
      finish(filled && filled.kind === "filled" ? `Order placed. ${formatToken(filled.totalSz, name)} at ${formatPrice(filled.avgPx)}.`
        : "Order placed. It waits on Hyperliquid until the price is reached.");
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = `${side === "long" ? "Long" : "Short"} ${name}`;
  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet" describedBy="perps-order-note">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {deposit.phase !== "idle" && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={`${title} order`} onSubmit={(event) => { event.preventDefault(); void place(); }}>
      <p className="mxDialogNote" id="perps-order-note">{side === "long" ? `Gains if ${name} rises.` : `Gains if ${name} falls.`} Up to {market.maxLeverage}x leverage.</p>
      <DollarAmount label="Amount" value={amount} onChange={setAmount} available={available} error={problem} />
      <PayWith amount={base} note={perpsAvailable !== null ? `${formatUsd(perpsAvailable)} already in perps` : undefined} />
      <div className="mkChoices">
        <Segmented label="Margin" value={isCross ? "cross" : "isolated"} onChange={(value) => setIsCross(value === "cross")}
          options={[{ value: "isolated", label: "Isolated" }, { value: "cross", label: "Cross", disabled: market.onlyIsolated }]} />
        <Segmented label="Order type" value={type} onChange={setType} options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit" }]} />
      </div>
      {type === "limit" && <label className="mxField">Limit price<input inputMode="decimal" value={limitPrice} onChange={(event) => setLimitPrice(event.target.value)} placeholder={formatPrice(market.markPx) ?? ""} /></label>}
      <label className="mkLeverage"><span className="mkLabel">Leverage <strong>{leverage}x</strong></span>
        <input type="range" min={1} max={market.maxLeverage} step={1} value={leverage} onChange={(event) => setLeverage(Number(event.target.value))} aria-valuetext={`${leverage}x`} />
        <span className="mkLeverageEnds" aria-hidden="true"><span>1x</span><span>{market.maxLeverage}x</span></span>
      </label>
      <dl className="mxSummary">
        <div><dt>Position size</dt><dd>{preview.data ? `${formatUsd(preview.data.notional)} · ${formatToken(preview.data.size, name)}` : "—"}</dd></div>
        <div><dt>Liquidation price</dt><dd data-testid="perps-liquidation">{preview.isError ? <span className="appUnavailable">Unavailable</span>
          : preview.data ? formatPrice(preview.data.liquidationPrice) ?? "None at this leverage" : "—"}</dd></div>
        {topUp > 0 && <div><dt>Added from USDC first</dt><dd>{formatUsd(topUp)}</dd></div>}
      </dl>
      <label className="mkSwitchRow"><span><strong>Auto-close</strong><small>Close at a profit or a loss you choose.</small></span>
        <input type="checkbox" className="appSwitch" checked={autoClose} onChange={(event) => setAutoClose(event.target.checked)} /></label>
      {autoClose && <div className="mxFieldRow">
        <label className="mxField">Take profit at<input inputMode="decimal" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} /></label>
        <label className="mxField">Stop loss at<input inputMode="decimal" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} /></label>
      </div>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={margin === null || problem !== null}>{side === "long" ? "Open long" : "Open short"}</button>
      <p className="mxHint">Prices move fast and you can lose all of it. Hyperliquid charges its own trading fee; Aura charges none.</p>
    </form>}
  </Sheet>;
}

/**
 * Add money (USDC from the Aura account, through Circle) or withdraw (back to
 * USDC on Base, signed by the wallet with the passkey).
 */
export function PerpsMoneySheet({ mode, account, onClose }: { mode: "add" | "withdraw"; account: PerpsAccount | undefined; onClose: () => void }) {
  const api = useApi();
  const wallet = useAuraWallet();
  const queryClient = useQueryClient();
  const usdc = useBaseUsdc();
  const deposit = useSettledAction("Deposit");
  const { flow, start, at, finish, fail, running } = useFlow();
  const [amount, setAmount] = useState("");
  const value = parseDollars(amount);
  const main = account?.dexStates.status === "observed" ? Number(account.dexStates.data.find((item) => item.dex === "")?.withdrawable ?? 0) : null;
  const available = mode === "add" ? usdc.amount : main;
  const problem = value === null ? null : available === null ? "Your balance can't be read right now."
    : value > available ? "That's more than you have." : mode === "add" && value < PERPS_MINIMUM_DEPOSIT ? `Add at least $${PERPS_MINIMUM_DEPOSIT}.` : null;

  async function submit() {
    if (value === null || problem) return;
    try {
      if (mode === "add") {
        start([{ key: "add", label: "Adding money…", detail: "Circle moves it to Hyperliquid, usually in under a minute." }]);
        await deposit.runAndWait(async () => (await api<{ action: ActionView }>("/api/perps/deposit", { method: "POST", json: { amount: value.toFixed(2) } })).action);
        finish(`${formatUsd(value)} added to perps, less Circle's fee.`);
      } else {
        start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Sending to your account…" }]);
        const request = await api<SignRequest>("/api/perps/withdraw", { method: "POST", json: { amount: value.toFixed(2) } });
        const authorization = await wallet.authorize(request.request);
        at("send");
        await api("/api/perps/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
        finish("Withdrawal sent. It arrives as USDC in your Aura account on Base in a few minutes, less Circle's fee.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = mode === "add" ? "Add money to perps" : "Withdraw from perps";
  return <Sheet onOpenChange={(open) => { if (!open && !running) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton" disabled={running}>Close</Dialog.Close></div>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {deposit.phase !== "idle" && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <DollarAmount label="Amount" value={amount} onChange={setAmount} available={available} error={problem} />
      {mode === "add" ? <PayWith amount={usdc.amount} /> : <dl className="mxSummary"><div><dt>Available to withdraw</dt><dd>{main === null ? <span className="appUnavailable">Unavailable</span> : formatUsd(main)}</dd></div>
        <div><dt>Arrives in</dt><dd>Your Aura account on Base</dd></div></dl>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={value === null || problem !== null}>{mode === "add" ? "Add money" : "Withdraw"}</button>
      <p className="mxHint">{mode === "add" ? `Circle moves USDC from Base to Hyperliquid and takes a small fee. Aura charges none. At least $${PERPS_MINIMUM_DEPOSIT}.`
        : "Your wallet signs the withdrawal with your passkey. Circle takes a small fee to deliver it."}</p>
    </form>}
  </Sheet>;
}

/** Close a whole position at market, or set its auto-close. Both are signed by Aura's trading key, no passkey. */
export function PositionSheet({ position, mode, onClose }: { position: PerpPosition; mode: "close" | "auto-close"; onClose: () => void }) {
  const api = useApi();
  const queryClient = useQueryClient();
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const name = perpName(position.coin);
  const side = positionSide(position.size);

  async function submit() {
    setBusy(true); setResult(null);
    try {
      const tp = parsePrice(takeProfit), sl = parsePrice(stopLoss);
      const response = mode === "close"
        ? await api<{ statuses: ExchangeStatus[] }>("/api/perps/positions/close", { method: "POST", json: { coin: position.coin } })
        : await api<{ statuses: ExchangeStatus[] }>("/api/perps/positions/tpsl", { method: "POST", json: { coin: position.coin,
          ...(tp ? { takeProfit: { triggerPrice: tp } } : {}), ...(sl ? { stopLoss: { triggerPrice: sl } } : {}) } });
      const refused = orderError(response.statuses);
      if (refused) throw new Error(`Hyperliquid didn't accept it: ${refused}`);
      setResult({ ok: true, text: mode === "close" ? "Position closed." : "Auto-close set." });
    } catch (error) {
      setResult({ ok: false, text: failureMessage(error) });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = mode === "close" ? `Close ${name} ${side}` : `Auto-close ${name} ${side}`;
  const ready = mode === "close" || parsePrice(takeProfit) !== null || parsePrice(stopLoss) !== null;
  return <Sheet onOpenChange={(open) => { if (!open && !busy) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
    {result?.ok ? <>
      <p className="mkFlowDone" role="status"><strong>{result.text}</strong></p>
      <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <dl className="mxSummary">
        <div><dt>Size</dt><dd>{formatToken(Math.abs(Number(position.size)), name)}</dd></div>
        <div><dt>Entry price</dt><dd>{formatPrice(position.entryPx)}</dd></div>
        <div><dt>Liquidation price</dt><dd>{formatPrice(position.liquidationPx) ?? "None"}</dd></div>
      </dl>
      {mode === "close" ? <p className="mxDialogNote">This closes the whole position at the market price now.</p>
        : <div className="mxFieldRow">
          <label className="mxField">Take profit at<input inputMode="decimal" value={takeProfit} onChange={(event) => setTakeProfit(event.target.value)} /></label>
          <label className="mxField">Stop loss at<input inputMode="decimal" value={stopLoss} onChange={(event) => setStopLoss(event.target.value)} /></label>
        </div>}
      {result && !result.ok && <p className="mkFlowFailed" role="alert">{result.text}</p>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={busy || !ready}>{busy ? "Sending…" : mode === "close" ? "Close position" : "Set auto-close"}</button>
    </form>}
  </Sheet>;
}
