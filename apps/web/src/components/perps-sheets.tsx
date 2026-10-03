"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useId, useState } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";
import { ApiError, useApi } from "@/lib/client/api";
import { deviceKey, ensureDeviceKey, type DeviceKey } from "@/lib/client/perps-key";
import { useAuraWallet } from "@/lib/client/use-aura-wallet";
import type { ActionView } from "@/lib/client/use-action";
import { formatToken, formatUsd } from "@/lib/format";
import type { PerpPosition } from "@/lib/markets/hyperliquid/info";
import type { TypedData } from "@/lib/markets/types";
import {
  cleanDecimal, closeSize, formatPrice, formatSignedUsd, orderKind, parseDollars, parsePrice, perpName, pnlAt, positionSide, PERPS_MINIMUM_DEPOSIT,
  triggerProblem
} from "@/lib/markets/view";
import { perpsTotals, useBaseUsdc, type PerpMarket, type PerpOrder, type PerpsAccount } from "./markets-data";
import { DollarAmount, failureMessage, FlowTimeline, PayWith, Segmented, useFlow, useSettledAction } from "./markets-parts";
import { Sheet } from "./sheet";
import { TransactionProgress } from "./transaction-progress";

export type SignRequest = { requestId: string; request: AuthorizationRequest<unknown> };
export type ExchangeStatus = { kind: "resting"; oid: number } | { kind: "filled"; oid: number; totalSz: string; avgPx: string } | { kind: "success" }
  | { kind: "waiting"; for: "fill" | "trigger" } | { kind: "error"; message: string };

/** Hyperliquid's answer to an order: the first error, or nothing. */
export const orderError = (statuses: ExchangeStatus[]) =>
  statuses.find((status): status is Extract<ExchangeStatus, { kind: "error" }> => status.kind === "error")?.message ?? null;

/** Actions Aura built for this device's trading key to sign, then relay (`/api/perps/relay`). */
type DeviceSignRequest = { status: "sign"; requestId: string; owner: string; typedData: TypedData[] };
const isDeviceRequest = (value: unknown): value is DeviceSignRequest =>
  typeof value === "object" && value !== null && (value as { status?: unknown }).status === "sign" && Array.isArray((value as { typedData?: unknown }).typedData);

async function relaySigned<T>(api: ReturnType<typeof useApi>, key: DeviceKey, request: DeviceSignRequest): Promise<T> {
  const signatures: string[] = [];
  for (const typedData of request.typedData) signatures.push(await key.sign(typedData));
  return api<T>("/api/perps/relay", { method: "POST", json: { requestId: request.requestId, signatures } });
}

/**
 * Connect this device to the customer's Hyperliquid account: make its trading
 * key here if it has none, and have the wallet approve it with the passkey.
 * Once per device; a device already approved needs no passkey.
 */
export async function connectPerps(api: ReturnType<typeof useApi>, authorize: (request: AuthorizationRequest<unknown>) => Promise<string>, owner: string | undefined) {
  if (!owner) throw new Error("Your wallet isn't ready yet. Try again in a moment.");
  const key = await ensureDeviceKey(owner);
  const setup = await api<{ status: "ready" } | ({ status: "sign" } & SignRequest)>("/api/perps/setup", { method: "POST", json: { agent: key.address } });
  if (setup.status === "ready") return;
  const authorization = await authorize(setup.request);
  const done = await api<{ next?: unknown }>("/api/perps/signatures", { method: "POST", json: { requestId: setup.requestId, authorization } });
  // Standard account mode, signed by the new key. A refusal leaves Hyperliquid's default mode; trading still works.
  if (isDeviceRequest(done.next)) await relaySigned(api, key, done.next).catch(() => undefined);
}

/**
 * Call a Perps route that builds an action for this device's trading key,
 * sign what it built here, and relay it. A device with no key, or one
 * Hyperliquid no longer knows, connects first (the passkey, once).
 */
export function usePerpsAction() {
  const api = useApi();
  const { authorize } = useAuraWallet();
  return useCallback(async <T,>(path: string, json: unknown): Promise<T> => {
    for (let attempt = 0; ; attempt += 1) {
      const answer = await api<T | DeviceSignRequest>(path, { method: "POST", json });
      if (!isDeviceRequest(answer)) return answer as T;
      let key = await deviceKey(answer.owner);
      if (!key) { await connectPerps(api, authorize, answer.owner); key = await deviceKey(answer.owner); }
      if (!key) throw new Error("This browser can't keep a trading key.");
      try { return await relaySigned<T>(api, key, answer); }
      catch (error) {
        if (attempt > 0 || !(error instanceof ApiError) || error.code !== "perps_not_connected") throw error;
        await connectPerps(api, authorize, answer.owner);
      }
    }
  }, [api, authorize]);
}

/** How long a deposit runs before the steps say it's slower than usual. It usually lands in seconds, a minute at most. */
export const SLOW_DEPOSIT_MS = 90_000;

/** The add-money step's usual detail, and its network fee once the deposit is prepared. */
export const ADD_MONEY_DETAIL = "Usually arrives in a few seconds.";

/**
 * A prepared deposit's network fee in dollars, from its review summary (what
 * leaves Base less what arrives in perps), or null when the summary doesn't
 * say. The provider that moves it (`summary.tool`) isn't named to the customer.
 */
export function depositFee(action: ActionView | null | undefined): number | null {
  const from = action?.summary.fromAmountRaw, to = action?.summary.toAmountRaw;
  if (typeof from !== "string" || typeof to !== "string" || !/^\d+$/.test(from) || !/^\d+$/.test(to)) return null;
  const fee = Number(BigInt(from) - BigInt(to)) / 1e6;
  return fee >= 0 ? fee : null;
}

/** "Network fee $0.02", or "Network fee under $0.01". */
export const feeText = (fee: number) => fee > 0 && fee < 0.01 ? "Network fee under $0.01" : `Network fee ${formatUsd(fee)}`;

/**
 * Resolve with the perps account's value once it reaches `target`, read from
 * Hyperliquid every 3 seconds, until `watch.stopped`. A credited deposit shows
 * here before the action settles in Aura's records.
 */
export async function waitForPerpsCredit(api: ReturnType<typeof useApi>, target: number, watch: { stopped: boolean }): Promise<number> {
  while (!watch.stopped) {
    await new Promise((resolve) => setTimeout(resolve, 3_000));
    if (watch.stopped) break;
    try {
      const value = perpsTotals(await api<PerpsAccount>("/api/perps/account"))?.value;
      if (value !== undefined && value >= target) return value;
    } catch { /* A failed read is tried again; it never ends the wait. */ }
  }
  return new Promise<number>(() => undefined);
}

/**
 * Add `amount` dollars of Base USDC to perps through the action flow and wait
 * for whichever comes first: the action settling, or the perps account
 * showing the money (less the network fee). Rejects if the action is
 * cancelled or fails before either. `onPrepared` gets the prepared action, whose
 * summary carries the fee.
 */
export async function addToPerps(options: { api: ReturnType<typeof useApi>; deposit: ReturnType<typeof useSettledAction>; amount: number; baseline: number | null;
  onSlow: () => void; onPrepared?: (action: ActionView) => void }): Promise<void> {
  const { api, deposit, amount, baseline, onSlow, onPrepared } = options;
  const watch = { stopped: false };
  const slow = setTimeout(onSlow, SLOW_DEPOSIT_MS);
  const settled = deposit.runAndWait(async () => {
    const { action } = await api<{ action: ActionView }>("/api/perps/deposit", { method: "POST", json: { amount: amount.toFixed(2) } });
    onPrepared?.(action);
    return action;
  });
  // The network fee comes out of the amount; the dollar kept back covers it.
  const credited = baseline === null ? new Promise<number>(() => undefined) : waitForPerpsCredit(api, baseline + amount - 1, watch);
  try {
    await Promise.race([settled, credited]);
  } finally {
    watch.stopped = true;
    clearTimeout(slow);
    settled.catch(() => undefined);
  }
}

/** A price field: digits and one decimal point only, "$" before it, and an optional line under it. */
export function PriceField({ label, value, onChange, placeholder, hint, error, action }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; hint?: React.ReactNode; error?: string | null;
  /** A small button after the label, such as "Mid". */
  action?: { label: string; onClick: () => void };
}) {
  const id = useId();
  return <div className="mkPriceField">
    <span className="mkLabelRow"><label className="mkLabel" htmlFor={id}>{label}</label>
      {action && <button type="button" className="appTextButton mkFieldAction" onClick={action.onClick}>{action.label}</button>}</span>
    <span className="mkPriceInput"><span aria-hidden="true">$</span>
      <input id={id} value={value} inputMode="decimal" autoComplete="off" placeholder={placeholder} aria-invalid={error ? true : undefined}
        aria-describedby={error || hint ? `${id}-note` : undefined} onChange={(event) => onChange(cleanDecimal(event.target.value))} /></span>
    {error ? <small className="mxFieldError" id={`${id}-note`}>{error}</small> : hint ? <small className="mkFieldHint" id={`${id}-note`}>{hint}</small> : null}
  </div>;
}

/**
 * Add money (USDC from the Aura account on Base) or withdraw (back to
 * USDC on Base, signed by the wallet with the passkey). The sheet can always
 * be closed: once sent, the money keeps moving and Transactions tracks it.
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
  const totals = perpsTotals(account);
  const main = account?.dexStates.status === "observed" ? Number(account.dexStates.data.find((item) => item.dex === "")?.withdrawable ?? 0) : null;
  const available = mode === "add" ? usdc.amount : main;
  const problem = value === null ? null : available === null ? "Your balance can't be read right now."
    : value > available ? "That's more than you have." : mode === "add" && value < PERPS_MINIMUM_DEPOSIT ? `Add at least $${PERPS_MINIMUM_DEPOSIT}.` : null;

  async function submit() {
    if (value === null || problem) return;
    try {
      if (mode === "add") {
        start([{ key: "add", label: "Adding money…", detail: ADD_MONEY_DETAIL }]);
        let fee: number | null = null;
        await addToPerps({ api, deposit, amount: value, baseline: totals?.value ?? null,
          onPrepared: (action) => { fee = depositFee(action); if (fee !== null) at("add", `${ADD_MONEY_DETAIL} ${feeText(fee)}.`); },
          onSlow: () => at("add", "This is taking longer than usual. The money is on its way; you can close this and follow it in Transactions.") });
        const arrived: number | null = fee;
        finish(arrived === null ? `${formatUsd(value)} added to perps, less the network fee.` : `${formatUsd(value - arrived)} added to perps (${formatUsd(value)} less a ${formatUsd(arrived)} network fee).`);
      } else {
        start([{ key: "sign", label: "Confirm with your passkey" }, { key: "send", label: "Sending to your Aura account" }]);
        const request = await api<SignRequest>("/api/perps/withdraw", { method: "POST", json: { amount: value.toFixed(2) } });
        const authorization = await wallet.authorize(request.request);
        at("send");
        await api("/api/perps/signatures", { method: "POST", json: { requestId: request.requestId, authorization } });
        finish("Withdrawal sent. It arrives as USDC in your Aura account on Base in a few minutes, less a small network fee.");
      }
    } catch (error) {
      if (error instanceof ApiError && error.code === "mfa_required") wallet.enrollPasskey();
      fail(failureMessage(error));
    } finally {
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = mode === "add" ? "Add money to perps" : "Withdraw from perps";
  const depositFailed = deposit.action?.status === "failed" || deposit.action?.status === "expired" || deposit.outcomeUnknown;
  return <Sheet onOpenChange={(open) => { if (!open) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
    {flow ? <>
      <FlowTimeline flow={flow} title={`${title} progress`} />
      {deposit.phase !== "idle" && (running || depositFailed) && <TransactionProgress label="Deposit" phase={deposit.phase} action={deposit.action} outcomeUnknown={deposit.outcomeUnknown} />}
      {running && mode === "add" && deposit.phase === "tracking" && <p className="mxHint">You can close this. The money keeps moving, and Transactions shows when it lands.</p>}
      {!running && <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>}
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <DollarAmount label="Amount" value={amount} onChange={setAmount} available={available} error={problem} />
      {mode === "add" ? <PayWith amount={usdc.amount} /> : <dl className="mxSummary">
        <div><dt>You can withdraw</dt><dd data-testid="perps-withdraw-available">{main === null ? <span className="appUnavailable">Unavailable</span> : formatUsd(main)}</dd></div>
        <div><dt>Arrives in</dt><dd>Your Aura account on Base</dd></div></dl>}
      {mode === "withdraw" && main !== null && totals && main < totals.value - 0.01 && <p className="mxHint">
        While positions are open, Hyperliquid keeps part of your balance back to support them. Close a position to withdraw more.</p>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={value === null || problem !== null}>{mode === "add" ? "Add money" : "Withdraw"}</button>
      <p className="mxHint">{mode === "add" ? `Moves USDC from your Aura account on Base to your perps balance. The network fee is a few cents; Aura charges none. At least $${PERPS_MINIMUM_DEPOSIT}.`
        : "Your wallet signs the withdrawal with your passkey. A small network fee comes out of it; Aura charges none."}</p>
    </form>}
  </Sheet>;
}

/** The take profit and stop loss orders resting on a position: Hyperliquid's reduce-only trigger orders for its market. */
export function positionTriggers(orders: PerpOrder[] | null, coin: string) {
  const mine = (orders ?? []).filter((order) => order.coin === coin && order.isTrigger && order.reduceOnly);
  return { takeProfit: mine.filter((order) => orderKind(order.orderType).kind === "tp"), stopLoss: mine.filter((order) => orderKind(order.orderType).kind === "sl") };
}

const CLOSE_SHARES = [0.25, 0.5, 0.75, 1] as const;

/**
 * Close a position, all or part of it, at the market price now or at a limit
 * price. All at market uses Hyperliquid's close; anything else is a
 * reduce-only order, which can only shrink the position. This device's
 * trading key signs it; no passkey.
 */
export function PositionCloseSheet({ position, market, onClose }: { position: PerpPosition; market: PerpMarket | undefined; onClose: () => void }) {
  const perpsAction = usePerpsAction();
  const queryClient = useQueryClient();
  const [type, setType] = useState<"market" | "limit">("market");
  const [share, setShare] = useState<(typeof CLOSE_SHARES)[number]>(1);
  const [price, setPrice] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const name = perpName(position.coin);
  const side = positionSide(position.size);
  const whole = Math.abs(Number(position.size));
  // Without the market's lot size, only the whole position can be closed, at market.
  const partial = market !== undefined;
  const size = share === 1 ? String(whole) : partial ? closeSize(position.size, share, market.szDecimals) : null;
  const limit = type === "limit" ? parsePrice(price) : null;
  const exit = type === "limit" ? (limit ? Number(limit) : null) : Number(market?.midPx ?? market?.markPx ?? NaN);
  const pnl = size && exit ? pnlAt(side, Number(size), Number(position.entryPx), exit) : null;
  const problem = size === null ? "That's smaller than this market allows. Close a larger share." : type === "limit" && price !== "" && !limit ? "Enter a price." : null;
  const ready = problem === null && (type === "market" || limit !== null);

  async function submit() {
    if (!ready || !size) return;
    setBusy(true); setResult(null);
    try {
      const response = type === "market" && share === 1
        ? await perpsAction<{ statuses: ExchangeStatus[] }>("/api/perps/positions/close", { coin: position.coin })
        : await perpsAction<{ statuses: ExchangeStatus[] }>("/api/perps/orders", { coin: position.coin, side: side === "long" ? "sell" : "buy",
          size, type, reduceOnly: true, ...(limit ? { limitPrice: limit } : {}) });
      const refused = orderError(response.statuses);
      if (refused) throw new Error(`Hyperliquid didn't accept it: ${refused}`);
      const filled = response.statuses.find((status) => status.kind === "filled");
      setResult({ ok: true, text: filled && filled.kind === "filled" ? `Closed ${formatToken(filled.totalSz, name)} at ${formatPrice(filled.avgPx)}.`
        : `Close order placed at ${formatPrice(limit)}. It waits on Hyperliquid until the price is reached.` });
    } catch (error) {
      setResult({ ok: false, text: failureMessage(error) });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = `Close ${name} ${side}`;
  return <Sheet onOpenChange={(open) => { if (!open) onClose(); }} className="mkSheet">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
    {result?.ok ? <>
      <p className="mkFlowDone" role="status"><strong>{result.text}</strong></p>
      <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <Segmented label="Close at" value={type} onChange={setType} className="mkFill"
        options={[{ value: "market", label: "Market" }, { value: "limit", label: "Limit", disabled: !partial }]} />
      {partial && <div className="mkShares mkFill" role="group" aria-label="How much to close">
        {CLOSE_SHARES.map((item) => <button type="button" key={item} className="mkChip" aria-pressed={share === item} onClick={() => setShare(item)}>
          {item === 1 ? "All" : `${item * 100}%`}</button>)}
      </div>}
      {type === "limit" && <PriceField label="Limit price" value={price} onChange={setPrice} placeholder={formatPrice(market?.midPx ?? market?.markPx)?.replace("$", "") ?? ""}
        action={market?.midPx ? { label: "Mid", onClick: () => setPrice(cleanDecimal(market.midPx!)) } : undefined} />}
      <dl className="mxSummary">
        <div><dt>Closing</dt><dd>{size ? `${formatToken(Number(size), name)} of ${formatToken(whole, name)}` : "—"}</dd></div>
        <div><dt>Entry price</dt><dd>{formatPrice(position.entryPx)}</dd></div>
        <div><dt>{type === "market" ? "Price now" : "Close at"}</dt><dd>{exit ? formatPrice(exit) : "—"}</dd></div>
        <div><dt>Estimated profit</dt><dd className={pnl !== null && pnl > 0 ? "mkUp" : undefined}>{pnl === null ? "—" : formatSignedUsd(pnl)}</dd></div>
      </dl>
      {problem && <p className="mxFieldError" role="alert">{problem}</p>}
      <p className="mxDialogNote">{type === "market" ? "Closes now at the best price on Hyperliquid, within 1% of the price shown." : "Waits on Hyperliquid until the price reaches your limit. It can only shrink the position."}</p>
      {result && !result.ok && <p className="mkFlowFailed" role="alert">{result.text}</p>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={busy || !ready}>{busy ? "Sending…" : share === 1 ? "Close position" : `Close ${share * 100}%`}</button>
    </form>}
  </Sheet>;
}

/**
 * Set a take profit and stop loss on a whole open position: Hyperliquid
 * closes it at market when the price reaches either, resizes them when the
 * position changes, and cancels them when it closes. A new one replaces the
 * old one of the same kind. This device's trading key signs; no passkey.
 */
export function PositionTpslSheet({ position, market, orders, onClose }: { position: PerpPosition; market: PerpMarket | undefined; orders: PerpOrder[] | null; onClose: () => void }) {
  const perpsAction = usePerpsAction();
  const queryClient = useQueryClient();
  const existing = positionTriggers(orders, position.coin);
  const [takeProfit, setTakeProfit] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const name = perpName(position.coin);
  const side = positionSide(position.size);
  const size = Math.abs(Number(position.size));
  const mark = market ? Number(market.markPx) : null;
  const tp = parsePrice(takeProfit), sl = parsePrice(stopLoss);
  const tpProblem = triggerProblem("tp", side, tp ? Number(tp) : null, mark);
  const slProblem = triggerProblem("sl", side, sl ? Number(sl) : null, mark);
  const ready = (tp !== null || sl !== null) && !tpProblem && !slProblem;
  const estimate = (price: string | null) => {
    const pnl = price ? pnlAt(side, size, Number(position.entryPx), Number(price)) : null;
    return pnl === null ? undefined : `${pnl >= 0 ? "Profit" : "Loss"} of about ${formatSignedUsd(pnl).replace(/^[+−]/, "")} on the whole position`;
  };

  async function cancel(order: PerpOrder) {
    await perpsAction("/api/perps/orders/cancel", { coin: order.coin, oid: order.oid });
  }

  async function submit() {
    if (!ready) return;
    setBusy(true); setResult(null);
    try {
      const response = await perpsAction<{ statuses: ExchangeStatus[] }>("/api/perps/positions/tpsl", { coin: position.coin,
        ...(tp ? { takeProfit: { triggerPrice: tp } } : {}), ...(sl ? { stopLoss: { triggerPrice: sl } } : {}) });
      const refused = orderError(response.statuses);
      if (refused) throw new Error(`Hyperliquid didn't accept it: ${refused}`);
      // The new one is in place; remove the ones it replaces, so a position never has two of a kind.
      await Promise.all([...(tp ? existing.takeProfit : []), ...(sl ? existing.stopLoss : [])].map(cancel));
      setResult({ ok: true, text: tp && sl ? "Take profit and stop loss set." : tp ? "Take profit set." : "Stop loss set." });
    } catch (error) {
      setResult({ ok: false, text: failureMessage(error) });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  async function remove(order: PerpOrder) {
    setBusy(true); setResult(null);
    try {
      await cancel(order);
      setResult({ ok: true, text: `${orderKind(order.orderType).label} removed.` });
    } catch (error) {
      setResult({ ok: false, text: failureMessage(error) });
    } finally {
      setBusy(false);
      void queryClient.invalidateQueries({ queryKey: ["perps-account"] });
    }
  }

  const title = `TP/SL for ${name} ${side}`;
  const current = [...existing.takeProfit, ...existing.stopLoss];
  return <Sheet onOpenChange={(open) => { if (!open) onClose(); }} className="mkSheet" describedBy="perps-tpsl-note">
    <div className="mxDialogHead"><Dialog.Title>{title}</Dialog.Title><Dialog.Close className="appTextButton">Close</Dialog.Close></div>
    {result?.ok ? <>
      <p className="mkFlowDone" role="status"><strong>{result.text}</strong></p>
      <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={onClose}>Done</button>
    </> : <form className="mkSheetBody" aria-label={title} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
      <p className="mxDialogNote" id="perps-tpsl-note">Take profit (TP) and stop loss (SL) close the whole position at the market price when {name} reaches the price you set.</p>
      <dl className="mxSummary">
        <div><dt>Entry price</dt><dd>{formatPrice(position.entryPx)}</dd></div>
        <div><dt>Price now</dt><dd>{mark ? formatPrice(mark) : <span className="appUnavailable">Unavailable</span>}</dd></div>
        <div><dt>Liquidation price</dt><dd>{formatPrice(position.liquidationPx) ?? "None"}</dd></div>
      </dl>
      {current.length > 0 && <ul className="mkTriggers" aria-label="Set now">{current.map((order) => <li key={order.oid}>
        <span>{orderKind(order.orderType).label} at {formatPrice(order.triggerPx)}</span>
        <button type="button" className="appTextButton" disabled={busy} onClick={() => void remove(order)}>Remove</button>
      </li>)}</ul>}
      <PriceField label="Take profit at" value={takeProfit} onChange={setTakeProfit} error={tpProblem} hint={estimate(tp)}
        placeholder={existing.takeProfit[0] ? formatPrice(existing.takeProfit[0].triggerPx)?.replace("$", "") : undefined} />
      <PriceField label="Stop loss at" value={stopLoss} onChange={setStopLoss} error={slProblem} hint={estimate(sl)}
        placeholder={existing.stopLoss[0] ? formatPrice(existing.stopLoss[0].triggerPx)?.replace("$", "") : undefined} />
      {result && !result.ok && <p className="mkFlowFailed" role="alert">{result.text}</p>}
      <button type="submit" className="appButton appButtonPrimary appButtonLarge" disabled={busy || !ready}>{busy ? "Sending…" : "Set TP/SL"}</button>
    </form>}
  </Sheet>;
}
