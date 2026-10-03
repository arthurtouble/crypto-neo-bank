import { VenueError } from "../types";
import type { PerpMarket, PerpPosition } from "./info";

/**
 * Pure order building for Hyperliquid perps. Prices and sizes are decimal
 * strings end to end, computed with bigint so no float rounding reaches a
 * signed action. Rules: https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/tick-and-lot-size
 */

/** Hyperliquid rejects orders worth less than $10 (reduce-only closes excepted). */
export const MIN_ORDER_VALUE_USD = "10";
export const DEFAULT_SLIPPAGE_BPS = 100;
const MAX_SLIPPAGE_BPS = 1_000;
const PERP_MAX_DECIMALS = 6;
const MAX_SIG_FIGS = 5;

/** Hyperliquid's own app sends take-profit and stop-loss market orders with 10% slippage. */
export const TPSL_SLIPPAGE_BPS = 1_000;

export type Tif = "Gtc" | "Ioc" | "Alo";
export type LimitOrderType = { limit: { tif: Tif } };
/** Key order (isMarket, triggerPx, tpsl) matches the Python SDK's `order_type_to_wire`. */
export type TriggerOrderType = { trigger: { isMarket: boolean; triggerPx: string; tpsl: "tp" | "sl" } };
/** Key order matches Hyperliquid's Python SDK `order_wire`; it is part of the signed hash. */
export type OrderWire = { a: number; b: boolean; p: string; s: string; r: boolean; t: LimitOrderType | TriggerOrderType };
/**
 * "na": plain orders. "normalTpsl": an entry followed by its take-profit and
 * stop-loss, sized like the entry. "positionTpsl": take-profit and stop-loss on
 * the whole position, resized by Hyperliquid as the position changes.
 */
export type OrderGrouping = "na" | "normalTpsl" | "positionTpsl";
export type OrderAction = { type: "order"; orders: OrderWire[]; grouping: OrderGrouping };
export type CancelAction = { type: "cancel"; cancels: Array<{ a: number; o: number }> };
export type UpdateLeverageAction = { type: "updateLeverage"; asset: number; isCross: boolean; leverage: number };

function invalid(message: string): VenueError {
  return new VenueError("hyperliquid", "invalid_order", message, 400);
}

// ---------------------------------------------------------------- decimals

/** value / 10^scale */
type Dec = { value: bigint; scale: number };

function parse(input: string, name: string): Dec {
  const match = /^(\d{1,30})(?:\.(\d{1,30}))?$/.exec(input.trim());
  if (!match) throw invalid(`The ${name} is not a valid number.`);
  const fraction = match[2] ?? "";
  return { value: BigInt(match[1] + fraction), scale: fraction.length };
}

function truncate(d: Dec, decimals: number): Dec {
  if (d.scale <= decimals) return d;
  return { value: d.value / 10n ** BigInt(d.scale - decimals), scale: decimals };
}

function toPlain(d: Dec): string {
  const digits = d.value.toString().padStart(d.scale + 1, "0");
  const whole = digits.slice(0, digits.length - d.scale);
  const fraction = digits.slice(digits.length - d.scale).replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole;
}

/** a ≥ b */
function gte(a: Dec, b: Dec): boolean {
  const scale = Math.max(a.scale, b.scale);
  return a.value * 10n ** BigInt(scale - a.scale) >= b.value * 10n ** BigInt(scale - b.scale);
}

function compare(a: Dec, b: Dec): number {
  const scale = Math.max(a.scale, b.scale);
  const left = a.value * 10n ** BigInt(scale - a.scale);
  const right = b.value * 10n ** BigInt(scale - b.scale);
  return left === right ? 0 : left > right ? 1 : -1;
}

function mul(a: Dec, b: Dec): Dec {
  return { value: a.value * b.value, scale: a.scale + b.scale };
}

function szDecimalsOf(szDecimals: number): number {
  if (!Number.isInteger(szDecimals) || szDecimals < 0 || szDecimals > PERP_MAX_DECIMALS) throw invalid("The market's size decimals are not valid.");
  return szDecimals;
}

// ---------------------------------------------------------------- formatting

/** Size rounded down to the market's lot (`szDecimals`), trailing zeros stripped. Zero throws. */
export function formatSize(size: string, szDecimals: number): string {
  const result = truncate(parse(size, "size"), szDecimalsOf(szDecimals));
  if (result.value === 0n) throw invalid("The size is smaller than this market allows.");
  return toPlain(result);
}

/**
 * Perp price rounded down to at most 5 significant figures and at most
 * (6 − szDecimals) decimals. A price whose whole part already has 5 or more
 * digits is sent as that whole number, which Hyperliquid always accepts.
 */
export function formatPrice(price: string, szDecimals: number): string {
  let result = truncate(parse(price, "price"), PERP_MAX_DECIMALS - szDecimalsOf(szDecimals));
  const whole = result.value / 10n ** BigInt(result.scale);
  if (whole >= 10n ** BigInt(MAX_SIG_FIGS - 1)) {
    result = { value: whole, scale: 0 };
  } else {
    const extra = result.value.toString().length - MAX_SIG_FIGS;
    if (extra > 0) result = truncate(result, result.scale - extra);
  }
  if (result.value === 0n) throw invalid("The price is smaller than this market allows.");
  return toPlain(result);
}

/** How much of the asset a dollar amount buys at `price`, rounded down to the market's lot. Zero throws. */
export function notionalToSize(usd: string, price: string, szDecimals: number): string {
  const notional = parse(usd, "amount");
  const px = parse(price, "price");
  if (px.value === 0n) throw invalid("The price is not valid.");
  const decimals = szDecimalsOf(szDecimals);
  // floor(usd / price) at `decimals`: (n / 10^ns) / (p / 10^ps) * 10^d
  const units = notional.value * 10n ** BigInt(px.scale + decimals) / (px.value * 10n ** BigInt(notional.scale));
  if (units === 0n) throw invalid("The amount is too small for this market.");
  return toPlain({ value: units, scale: decimals });
}

/** size × price as a plain decimal string. */
export function orderValue(size: string, price: string): string {
  return toPlain(mul(parse(size, "size"), parse(price, "price")));
}

export function meetsMinimumOrderValue(size: string, price: string): boolean {
  return gte(mul(parse(size, "size"), parse(price, "price")), parse(MIN_ORDER_VALUE_USD, "minimum"));
}

/** Reference price moved against the trader by `slippageBps`, then formatted to a valid price. */
export function slippagePrice(reference: string, side: "buy" | "sell", slippageBps: number, szDecimals: number): string {
  if (!Number.isInteger(slippageBps) || slippageBps < 1 || slippageBps > MAX_SLIPPAGE_BPS) {
    throw invalid("Slippage must be between 0.01% and 10%.");
  }
  const factor: Dec = { value: BigInt(side === "buy" ? 10_000 + slippageBps : 10_000 - slippageBps), scale: 4 };
  return formatPrice(toPlain(mul(parse(reference, "price"), factor)), szDecimals);
}

// ---------------------------------------------------------------- actions

function assetIndexOf(index: number): number {
  if (!Number.isSafeInteger(index) || index < 0) throw invalid("The market is not valid.");
  return index;
}

/** A take-profit or stop-loss: a market order once `triggerPrice` trades, or a limit at `limitPrice`. */
export type TriggerSpec = { triggerPrice: string; limitPrice?: string };

/**
 * The reduce-only order that closes `side`'s position at a trigger. A market
 * trigger still needs a worst price; it is the trigger moved 10% against the
 * close, as Hyperliquid's own app does.
 */
function triggerOrder(market: Pick<PerpMarket, "assetIndex" | "szDecimals">, entrySide: "buy" | "sell", size: string,
  tpsl: "tp" | "sl", spec: TriggerSpec): OrderWire {
  const triggerPx = formatPrice(spec.triggerPrice, market.szDecimals);
  const closeSide = entrySide === "buy" ? "sell" : "buy";
  const p = spec.limitPrice === undefined ? slippagePrice(triggerPx, closeSide, TPSL_SLIPPAGE_BPS, market.szDecimals)
    : formatPrice(spec.limitPrice, market.szDecimals);
  return { a: assetIndexOf(market.assetIndex), b: closeSide === "buy", p, s: size, r: true,
    t: { trigger: { isMarket: spec.limitPrice === undefined, triggerPx, tpsl } } };
}

/** A long's take-profit sits above `reference` and its stop-loss below; a short's the other way round. */
function checkTriggers(entrySide: "buy" | "sell", reference: string, takeProfit?: TriggerSpec, stopLoss?: TriggerSpec): void {
  const ref = parse(reference, "price");
  const above = entrySide === "buy" ? 1 : -1;
  if (takeProfit && compare(parse(takeProfit.triggerPrice, "take-profit price"), ref) !== above) {
    throw invalid(entrySide === "buy" ? "Take profit must be above the current price." : "Take profit must be below the current price.");
  }
  if (stopLoss && compare(parse(stopLoss.triggerPrice, "stop-loss price"), ref) !== -above) {
    throw invalid(entrySide === "buy" ? "Stop loss must be below the current price." : "Stop loss must be above the current price.");
  }
}

/**
 * One order, optionally with a take-profit and stop-loss sized like it
 * ("normalTpsl"). A market order is an immediate-or-cancel limit at mid ±
 * slippage, which is how Hyperliquid's own SDKs place them; a limit order rests
 * (Gtc). Orders below Hyperliquid's $10 minimum fail here unless reduce-only.
 */
export function buildOrderAction(input: {
  market: Pick<PerpMarket, "assetIndex" | "szDecimals" | "midPx">;
  side: "buy" | "sell";
  size: string;
  type: "market" | "limit";
  limitPrice?: string;
  reduceOnly?: boolean;
  slippageBps?: number;
  takeProfit?: TriggerSpec;
  stopLoss?: TriggerSpec;
}): OrderAction {
  const { market } = input;
  const size = formatSize(input.size, market.szDecimals);
  let price: string;
  let reference: string;
  if (input.type === "limit") {
    if (input.limitPrice === undefined) throw invalid("A limit order needs a price.");
    price = formatPrice(input.limitPrice, market.szDecimals);
    reference = price;
  } else {
    if (market.midPx === null) throw new VenueError("hyperliquid", "no_liquidity", "This market has no price right now.", 409);
    price = slippagePrice(market.midPx, input.side, input.slippageBps ?? DEFAULT_SLIPPAGE_BPS, market.szDecimals);
    reference = market.midPx;
  }
  const reduceOnly = input.reduceOnly ?? false;
  if (!reduceOnly && !meetsMinimumOrderValue(size, price)) throw invalid(`Orders must be worth at least $${MIN_ORDER_VALUE_USD}.`);
  const entry: OrderWire = { a: assetIndexOf(market.assetIndex), b: input.side === "buy", p: price, s: size, r: reduceOnly,
    t: { limit: { tif: input.type === "market" ? "Ioc" : "Gtc" } } };
  if (!input.takeProfit && !input.stopLoss) return { type: "order", orders: [entry], grouping: "na" };
  if (reduceOnly) throw invalid("A closing order can't carry its own take profit or stop loss.");
  checkTriggers(input.side, reference, input.takeProfit, input.stopLoss);
  const orders = [entry];
  if (input.takeProfit) orders.push(triggerOrder(market, input.side, size, "tp", input.takeProfit));
  if (input.stopLoss) orders.push(triggerOrder(market, input.side, size, "sl", input.stopLoss));
  return { type: "order", orders, grouping: "normalTpsl" };
}

/**
 * Take-profit and/or stop-loss on a whole open position ("positionTpsl").
 * Hyperliquid resizes them as the position changes and cancels them when it
 * closes. Triggers are checked against the mark price.
 */
export function buildPositionTpslAction(input: {
  position: Pick<PerpPosition, "coin" | "size">;
  market: Pick<PerpMarket, "coin" | "assetIndex" | "szDecimals" | "markPx">;
  takeProfit?: TriggerSpec;
  stopLoss?: TriggerSpec;
}): OrderAction {
  const { position, market } = input;
  if (position.coin !== market.coin) throw invalid("The position and market do not match.");
  if (!input.takeProfit && !input.stopLoss) throw invalid("Set a take profit or a stop loss.");
  const short = position.size.startsWith("-");
  const size = formatSize(short ? position.size.slice(1) : position.size, market.szDecimals);
  const entrySide = short ? "sell" : "buy";
  checkTriggers(entrySide, market.markPx, input.takeProfit, input.stopLoss);
  const orders: OrderWire[] = [];
  if (input.takeProfit) orders.push(triggerOrder(market, entrySide, size, "tp", input.takeProfit));
  if (input.stopLoss) orders.push(triggerOrder(market, entrySide, size, "sl", input.stopLoss));
  return { type: "order", orders, grouping: "positionTpsl" };
}

/** Close a whole position at market: reduce-only IOC on the opposite side for its full size. */
export function buildCloseAction(position: Pick<PerpPosition, "coin" | "size">,
  market: Pick<PerpMarket, "coin" | "assetIndex" | "szDecimals" | "midPx">, slippageBps = DEFAULT_SLIPPAGE_BPS): OrderAction {
  if (position.coin !== market.coin) throw invalid("The position and market do not match.");
  const short = position.size.startsWith("-");
  const size = short ? position.size.slice(1) : position.size;
  return buildOrderAction({ market, side: short ? "buy" : "sell", size, type: "market", reduceOnly: true, slippageBps });
}

export function buildCancelAction(assetIndex: number, oid: number): CancelAction {
  if (!Number.isSafeInteger(oid) || oid < 0) throw invalid("The order is not valid.");
  return { type: "cancel", cancels: [{ a: assetIndexOf(assetIndex), o: oid }] };
}

/** Leverage is a whole number from 1 to the market's own maximum; isolated-only markets refuse cross. */
export function buildUpdateLeverageAction(market: Pick<PerpMarket, "assetIndex" | "maxLeverage" | "onlyIsolated">,
  isCross: boolean, leverage: number): UpdateLeverageAction {
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > market.maxLeverage) {
    throw invalid(`Leverage must be between 1 and ${market.maxLeverage}.`);
  }
  if (isCross && market.onlyIsolated) throw invalid("This market only allows isolated margin.");
  return { type: "updateLeverage", asset: assetIndexOf(market.assetIndex), isCross, leverage };
}

// ---------------------------------------------------------------- sizing and risk

/**
 * Size for a position backed by `marginUsd` at `leverage`: notional = margin ×
 * leverage, size = notional ÷ price rounded down to the lot. Returns the margin
 * and notional the rounded size really uses. Throws when the order would be
 * under Hyperliquid's $10 minimum or the leverage is out of the market's range.
 */
export function sizeFromMargin(input: { marginUsd: string; leverage: number; price: string;
  market: Pick<PerpMarket, "szDecimals" | "maxLeverage"> }): { size: string; notional: string; margin: string } {
  const { leverage, market } = input;
  if (!Number.isInteger(leverage) || leverage < 1 || leverage > market.maxLeverage) {
    throw invalid(`Leverage must be between 1 and ${market.maxLeverage}.`);
  }
  const target = toPlain(mul(parse(input.marginUsd, "amount"), { value: BigInt(leverage), scale: 0 }));
  const size = notionalToSize(target, input.price, market.szDecimals);
  if (!meetsMinimumOrderValue(size, input.price)) throw invalid(`Orders must be worth at least $${MIN_ORDER_VALUE_USD}.`);
  const notional = mul(parse(size, "size"), parse(input.price, "price"));
  // Margin rounded up to the cent so a displayed amount is never less than what the position holds.
  const cents = (notional.value * 100n + BigInt(leverage) * 10n ** BigInt(notional.scale) - 1n)
    / (BigInt(leverage) * 10n ** BigInt(notional.scale));
  return { size, notional: toPlain(notional), margin: toPlain({ value: cents, scale: 2 }) };
}

/**
 * Hyperliquid's maintenance margin rate: half the initial margin at the
 * market's maximum leverage, so 1 / (2 × maxLeverage). Margin tiers that lower
 * leverage for very large positions are not modelled.
 */
function maintenanceRate(maxLeverage: number): number {
  if (!Number.isInteger(maxLeverage) || maxLeverage < 1) throw invalid("The market's leverage is not valid.");
  return 1 / (2 * maxLeverage);
}

/** Maintenance margin a position of `size` at `price` needs, for adding a new position to `crossLiquidationPrice`. */
export function maintenanceMargin(size: string, price: string, maxLeverage: number): number {
  return Number(size) * Number(price) * maintenanceRate(maxLeverage);
}

/** Display rounding: 6 significant figures, no exponent. Null when there is no liquidation price. */
function liquidationDisplay(value: number): string | null {
  if (!Number.isFinite(value) || value <= 0) return null;
  const digits = Math.max(0, 5 - Math.floor(Math.log10(value)));
  return value.toFixed(Math.min(digits, 8)).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

/**
 * Hyperliquid's documented liquidation price,
 *   liq = price − side × marginAvailable ÷ size ÷ (1 − l × side),  l = 1 / (2 × maxLeverage),
 * with side 1 for long and −1 for short. Isolated: marginAvailable = isolated
 * margin − maintenance margin, which with margin = notional ÷ leverage makes the
 * price independent of size. An estimate for display, not a guarantee: funding,
 * fees, and margin tiers move it.
 */
export function isolatedLiquidationPrice(input: { side: "long" | "short"; entryPx: string; leverage: number;
  maxLeverage: number }): string | null {
  const l = maintenanceRate(input.maxLeverage);
  if (!Number.isInteger(input.leverage) || input.leverage < 1 || input.leverage > input.maxLeverage) {
    throw invalid(`Leverage must be between 1 and ${input.maxLeverage}.`);
  }
  const side = input.side === "long" ? 1 : -1;
  parse(input.entryPx, "price");
  const entry = Number(input.entryPx);
  return liquidationDisplay(entry - side * entry * (1 / input.leverage - l) / (1 - l * side));
}

/**
 * Cross margin: marginAvailable = cross account value − cross maintenance
 * margin, both straight from `accountState` (`crossAccountValue`,
 * `crossMaintenanceMarginUsed`) with `price` the mark. Reproduces
 * Hyperliquid's own `liquidationPx` for open positions. For a position not yet
 * open, add its `maintenanceMargin` to `maintenanceMarginUsed` and use the
 * expected entry price. Leverage does not change a cross liquidation price.
 */
export function crossLiquidationPrice(input: { side: "long" | "short"; size: string; price: string; maxLeverage: number;
  accountValue: string; maintenanceMarginUsed: string | number }): string | null {
  const l = maintenanceRate(input.maxLeverage);
  const side = input.side === "long" ? 1 : -1;
  const size = Number(input.size.replace(/^-/, ""));
  const price = Number(input.price);
  if (!(size > 0) || !(price > 0)) throw invalid("The position is not valid.");
  const available = Number(input.accountValue) - Number(input.maintenanceMarginUsed);
  return liquidationDisplay(price - side * available / size / (1 - l * side));
}
