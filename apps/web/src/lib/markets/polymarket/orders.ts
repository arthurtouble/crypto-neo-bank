import { concat, getAddress, hashDomain, hashStruct, isAddress, numberToHex, stringToHex, type Hex } from "viem";
import { z } from "zod";
import { VenueError, type TypedData } from "../types";
import { assertOwnerSignature, depositWalletAddress } from "./account";
import { clobSigner, type ClobSession } from "./auth";
import { POLYGON_CHAIN_ID, POLYMARKET_CONTRACTS, ZERO_BYTES32, numeric, polymarketRequest, type RequestOptions } from "./http";
import { TICK_SIZES, type OrderBook, type TickSize } from "./markets";

/**
 * CLOB orders for a Deposit Wallet (signature type 3, ERC-1271). The wallet
 * is both maker and signer; its owner signs the order wrapped in an ERC-7739
 * `TypedDataSign`, and the signature sent to the CLOB carries the exchange
 * domain, the order hash, and the order type so the wallet can check it.
 * Amounts follow the official SDK's fixed-point rules exactly, so the CLOB's
 * own rounding checks pass.
 */

export type OrderSide = "BUY" | "SELL";
export type OrderType = "GTC" | "GTD" | "FAK" | "FOK";

const SIGNATURE_TYPE_POLY_1271 = 3;
const EXCHANGE_NAME = "Polymarket CTF Exchange";
const ORDER_TYPE_STRING = "Order(uint256 salt,address maker,address signer,uint256 tokenId,uint256 makerAmount,uint256 takerAmount,uint8 side,uint8 signatureType,uint256 timestamp,bytes32 metadata,bytes32 builder)";
const ORDER_FIELDS = [
  { name: "salt", type: "uint256" }, { name: "maker", type: "address" }, { name: "signer", type: "address" },
  { name: "tokenId", type: "uint256" }, { name: "makerAmount", type: "uint256" }, { name: "takerAmount", type: "uint256" },
  { name: "side", type: "uint8" }, { name: "signatureType", type: "uint8" }, { name: "timestamp", type: "uint256" },
  { name: "metadata", type: "bytes32" }, { name: "builder", type: "bytes32" }
];
const DOMAIN_FIELDS = [
  { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }
];
const TYPED_DATA_SIGN_FIELDS = [
  { name: "contents", type: "Order" }, { name: "name", type: "string" }, { name: "version", type: "string" },
  { name: "chainId", type: "uint256" }, { name: "verifyingContract", type: "address" }, { name: "salt", type: "bytes32" }
];
const MIN_GTD_SECONDS = 180;
/** The CLOB rejects marketable buys under $1. */
export const MIN_MARKET_BUY_PUSD = 1;

const SCALE = 1_000_000n;
const invalid = (message: string) => new VenueError("polymarket", "invalid_request", message, 400);

/** Decimals for the order's quote amount and share size, per tick size (from the SDK). */
const ROUNDING: Record<TickSize, { amount: number; size: number }> = {
  0.1: { amount: 3, size: 2 }, 0.01: { amount: 4, size: 2 }, 0.005: { amount: 5, size: 2 },
  0.0025: { amount: 6, size: 2 }, 0.001: { amount: 5, size: 2 }, 0.0001: { amount: 6, size: 2 }
};

/**
 * A number or decimal string as 6-decimal fixed point, truncating beyond 6
 * decimals. Numbers use the SDK's tolerance for binary floating point.
 */
export function toScaled(value: number | string): bigint {
  if (typeof value === "string") {
    const match = /^(\d{1,15})(?:\.(\d+))?$/.exec(value.trim());
    if (!match) throw invalid("Invalid amount.");
    return BigInt(match[1] as string) * SCALE + BigInt(((match[2] ?? "") + "000000").slice(0, 6));
  }
  if (!Number.isFinite(value) || value < 0 || value > 1e15) throw invalid("Invalid amount.");
  const scaled = value * 1e6;
  const candidate = Math.round(scaled);
  return BigInt(Math.abs(scaled - candidate) <= 8 * Number.EPSILON * Math.max(1, scaled) ? candidate : Math.trunc(scaled));
}

/** A price as 6-decimal fixed point; more precision than that is an error, not a rounding. */
function toScaledPrice(value: number | string): bigint {
  if (typeof value === "string") {
    if (!/^0?\.\d{1,6}$|^[01](\.0{1,6})?$/.test(value.trim())) throw invalid("Invalid price.");
    return toScaled(value);
  }
  const candidate = Math.round(value * 1e6);
  if (!Number.isSafeInteger(candidate) || Math.abs(value - candidate / 1e6) > 8 * Number.EPSILON) throw invalid("Invalid price.");
  return BigInt(candidate);
}

const quantum = (decimals: number) => 10n ** BigInt(6 - decimals);
const mulDiv = (value: bigint, multiplier: bigint, denominator: bigint, up: boolean) => {
  const numerator = value * multiplier;
  return numerator / denominator + (up && numerator % denominator !== 0n ? 1n : 0n);
};
const quantize = (value: bigint, decimals: number) => (value / quantum(decimals)) * quantum(decimals);

/** Validate a price against the tick grid, inside `[tick, 1 - tick]`. */
export function priceOnTick(price: number | string, tickSize: TickSize): bigint {
  if (!(TICK_SIZES as readonly number[]).includes(tickSize)) throw invalid("Unsupported tick size.");
  const scaled = toScaledPrice(price);
  const tick = toScaledPrice(tickSize);
  if (scaled < tick || scaled > SCALE - tick) throw invalid(`Price must be between ${tickSize} and ${1 - tickSize}.`);
  if (scaled % tick !== 0n) throw invalid(`Price must be a multiple of ${tickSize}.`);
  return scaled;
}

/** Limit order amounts (SDK `computeLimitOrderAmounts`): size truncated to 2 decimals, quote rounded down. */
export function limitOrderAmounts(side: OrderSide, price: bigint, size: number | string, tickSize: TickSize): { makerAmount: bigint; takerAmount: bigint; size: bigint } {
  const rounding = ROUNDING[tickSize];
  const shares = quantize(toScaled(size), rounding.size);
  const quote = mulDiv(shares, price, SCALE * quantum(rounding.amount), false) * quantum(rounding.amount);
  return side === "BUY" ? { makerAmount: quote, takerAmount: shares, size: shares } : { makerAmount: shares, takerAmount: quote, size: shares };
}

/**
 * Market order amounts (SDK `computeMarketOrderAmounts`, protected price):
 * a buy offers `amount` pUSD for at least `amount / price` shares, a sell
 * offers shares for at least `shares * price` pUSD, both rounded up so the
 * effective price never crosses `price`.
 */
export function marketOrderAmounts(side: OrderSide, price: bigint, amount: number | string, tickSize: TickSize): { makerAmount: bigint; takerAmount: bigint } {
  const rounding = ROUNDING[tickSize];
  const offered = quantize(toScaled(amount), rounding.size);
  const q = quantum(rounding.amount);
  const requested = side === "BUY" ? mulDiv(offered, SCALE, price * q, true) * q : mulDiv(offered, price, SCALE * q, true) * q;
  return { makerAmount: offered, takerAmount: requested };
}

/** Protocol v2 position ids leave bits 40..103 clear; CTF token ids are hashes. Mirrors the SDK. */
function isV2PositionId(tokenId: string): boolean {
  return (BigInt(tokenId) & (((1n << 64n) - 1n) << 40n)) === 0n;
}

/** The exchange that settles this token, and its EIP-712 domain version. */
export function orderExchange(tokenId: string, negRisk: boolean): { exchange: `0x${string}`; version: "2" | "3" } {
  if (isV2PositionId(tokenId)) return { exchange: POLYMARKET_CONTRACTS.exchangeV3, version: "3" };
  return { exchange: negRisk ? POLYMARKET_CONTRACTS.negRiskExchange : POLYMARKET_CONTRACTS.standardExchange, version: "2" };
}

/** The order as signed and as sent to the CLOB; uint256 fields are decimal strings. */
export type UnsignedOrder = {
  salt: string;
  maker: `0x${string}`;
  signer: `0x${string}`;
  tokenId: string;
  makerAmount: string;
  takerAmount: string;
  side: OrderSide;
  signatureType: 3;
  timestamp: string;
  metadata: `0x${string}`;
  builder: `0x${string}`;
  /** Sent to the CLOB but not signed; "0" unless the order is GTD. */
  expiration: string;
};

export type BuildOrderInput = {
  wallet: string;
  tokenId: string;
  side: OrderSide;
  /** Limit price, or the worst acceptable price for FAK/FOK. */
  price: number | string;
  negRisk: boolean;
  tickSize: TickSize;
  /** Shares for limit orders and sells, in whole-share units. */
  size?: number | string;
  /** pUSD to spend on a market (FAK/FOK) buy. Taker fees are charged on top. */
  amount?: number | string;
  minOrderSize?: number;
  orderType?: OrderType;
  /** Unix seconds; makes the order GTD and must be at least 3 minutes out. */
  expiration?: number;
  builderCode?: `0x${string}`;
  now?: Date;
  /** For tests only; production salts are random. */
  salt?: bigint;
};

export type BuiltOrder = { order: UnsignedOrder; orderType: OrderType; exchange: `0x${string}`; typedData: TypedData };

function randomSalt(): bigint {
  const bytes = crypto.getRandomValues(new Uint8Array(8));
  // 53 bits: the CLOB takes the salt as a JSON number, so it must survive a double.
  return bytes.reduce((value, byte) => (value << 8n) | BigInt(byte), 0n) & ((1n << 53n) - 1n);
}

/**
 * Build an order and the typed data the owner signs. A `size` without a
 * FAK/FOK type is a limit order (GTC, or GTD with `expiration`); `amount`
 * is a market buy and FAK/FOK with `size` a market sell.
 */
export function buildOrder(input: BuildOrderInput): BuiltOrder {
  if (!isAddress(input.wallet, { strict: false })) throw invalid("Invalid wallet address.");
  if (!/^\d{1,78}$/.test(input.tokenId)) throw invalid("Unknown outcome.");
  if (input.side !== "BUY" && input.side !== "SELL") throw invalid("Unknown side.");
  if (input.builderCode !== undefined && !/^0x[\da-fA-F]{64}$/.test(input.builderCode)) throw invalid("Invalid builder code.");
  const wallet = getAddress(input.wallet);
  const price = priceOnTick(input.price, input.tickSize);
  const now = input.now ?? new Date();
  const market = input.amount !== undefined || input.orderType === "FAK" || input.orderType === "FOK";
  let orderType: OrderType;
  let amounts: { makerAmount: bigint; takerAmount: bigint };
  let expiration = "0";
  if (market) {
    orderType = input.orderType ?? "FAK";
    if (orderType !== "FAK" && orderType !== "FOK") throw invalid("A market order is FAK or FOK.");
    if (input.expiration !== undefined) throw invalid("A market order has no expiration.");
    if (input.side === "BUY") {
      if (input.amount === undefined || input.size !== undefined) throw invalid("A market buy takes an amount to spend.");
      if (toScaled(input.amount) < BigInt(MIN_MARKET_BUY_PUSD) * SCALE) throw new VenueError("polymarket", "below_minimum", `The minimum is ${MIN_MARKET_BUY_PUSD} pUSD.`, 400);
      amounts = marketOrderAmounts("BUY", price, input.amount, input.tickSize);
    } else {
      if (input.size === undefined || input.amount !== undefined) throw invalid("A market sell takes a number of shares.");
      amounts = marketOrderAmounts("SELL", price, input.size, input.tickSize);
    }
  } else {
    if (input.size === undefined) throw invalid("A limit order takes a number of shares.");
    const limit = limitOrderAmounts(input.side, price, input.size, input.tickSize);
    if (input.minOrderSize !== undefined && limit.size < toScaled(input.minOrderSize)) {
      throw new VenueError("polymarket", "below_minimum", `The minimum is ${input.minOrderSize} shares.`, 400);
    }
    amounts = limit;
    if (input.expiration !== undefined) {
      if (!Number.isSafeInteger(input.expiration) || input.expiration < Math.floor(now.getTime() / 1000) + MIN_GTD_SECONDS) {
        throw invalid("An expiring order must last at least 3 minutes.");
      }
      if (input.orderType !== undefined && input.orderType !== "GTD") throw invalid("Only a GTD order expires.");
      orderType = "GTD";
      expiration = String(input.expiration);
    } else {
      if (input.orderType === "GTD") throw invalid("A GTD order needs an expiration.");
      orderType = "GTC";
    }
  }
  if (amounts.makerAmount <= 0n || amounts.takerAmount <= 0n) throw new VenueError("polymarket", "below_minimum", "The order is too small.", 400);
  const { exchange, version } = orderExchange(input.tokenId, input.negRisk);
  const order: UnsignedOrder = {
    salt: String(input.salt ?? randomSalt()),
    maker: wallet,
    signer: wallet,
    tokenId: input.tokenId,
    makerAmount: String(amounts.makerAmount),
    takerAmount: String(amounts.takerAmount),
    side: input.side,
    signatureType: SIGNATURE_TYPE_POLY_1271,
    timestamp: String(now.getTime()),
    metadata: ZERO_BYTES32,
    builder: (input.builderCode ?? ZERO_BYTES32).toLowerCase() as `0x${string}`,
    expiration
  };
  return { order, orderType, exchange, typedData: orderTypedData(order, exchange, version) };
}

const orderContents = (order: UnsignedOrder) => ({
  salt: order.salt, maker: order.maker, signer: order.signer, tokenId: order.tokenId,
  makerAmount: order.makerAmount, takerAmount: order.takerAmount, side: order.side === "BUY" ? 0 : 1,
  signatureType: order.signatureType, timestamp: order.timestamp, metadata: order.metadata, builder: order.builder
});

/** The ERC-7739 `TypedDataSign` over the order, as the Deposit Wallet verifies it for its owner. */
export function orderTypedData(order: UnsignedOrder, exchange: `0x${string}`, version: "2" | "3"): TypedData {
  return {
    domain: { name: EXCHANGE_NAME, version, chainId: POLYGON_CHAIN_ID, verifyingContract: exchange },
    types: { EIP712Domain: DOMAIN_FIELDS, Order: ORDER_FIELDS, TypedDataSign: TYPED_DATA_SIGN_FIELDS },
    primaryType: "TypedDataSign",
    message: { contents: orderContents(order), name: "DepositWallet", version: "1", chainId: POLYGON_CHAIN_ID, verifyingContract: order.signer, salt: ZERO_BYTES32 }
  };
}

const uint = z.string().regex(/^\d{1,78}$/).transform(BigInt);
const hexAddress = z.string().regex(/^0x[\da-fA-F]{40}$/).transform((value) => getAddress(value));
const bytes32 = z.string().regex(/^0x[\da-fA-F]{64}$/).transform((value) => value as Hex);
const orderTypedDataSchema = z.object({
  domain: z.object({ name: z.literal(EXCHANGE_NAME), version: z.enum(["2", "3"]), chainId: z.literal(POLYGON_CHAIN_ID), verifyingContract: hexAddress }),
  primaryType: z.literal("TypedDataSign"),
  message: z.object({
    contents: z.object({
      salt: uint, maker: hexAddress, signer: hexAddress, tokenId: uint, makerAmount: uint, takerAmount: uint,
      side: z.union([z.literal(0), z.literal(1)]), signatureType: z.literal(SIGNATURE_TYPE_POLY_1271), timestamp: uint, metadata: bytes32, builder: bytes32
    }),
    name: z.literal("DepositWallet"), version: z.literal("1"), chainId: z.literal(POLYGON_CHAIN_ID), verifyingContract: hexAddress, salt: bytes32
  })
});

/**
 * The signature the CLOB takes for a Deposit Wallet order: the owner's
 * 65-byte signature, then the exchange domain separator, the order's struct
 * hash, the order type string, and its length as two bytes (ERC-7739). An
 * owner's signature is not wrapped further; only session keys add a prefix.
 */
export function wrapOrderSignature(typedData: TypedData, ownerSignature: string): Hex {
  if (!/^0x[\da-fA-F]{130}$/.test(ownerSignature)) throw new VenueError("polymarket", "invalid_signature", "The signature is malformed.", 400);
  const parsed = orderTypedDataSchema.safeParse(typedData);
  if (!parsed.success) throw invalid("This is not an order to sign.");
  const { domain, message } = parsed.data;
  const domainSeparator = hashDomain({ domain, types: { EIP712Domain: DOMAIN_FIELDS } } as Parameters<typeof hashDomain>[0]);
  const contentsHash = hashStruct({ data: message.contents, primaryType: "Order", types: { Order: ORDER_FIELDS } });
  return concat([ownerSignature.toLowerCase() as Hex, domainSeparator, contentsHash, stringToHex(ORDER_TYPE_STRING), numberToHex(ORDER_TYPE_STRING.length, { size: 2 })]);
}

export type PostedOrder = {
  orderId: string;
  /** `matched` filled at once (fully or partly), `live` rests on the book, `delayed` is queued by the market. */
  status: "live" | "matched" | "delayed";
  makingAmount: string;
  takingAmount: string;
  tradeIds: string[];
};

const postResponse = z.object({
  success: z.boolean(),
  errorMsg: z.string().max(1_000).default(""),
  orderID: z.string().max(200).default(""),
  status: z.string().max(40).default(""),
  makingAmount: z.string().max(80).default(""),
  takingAmount: z.string().max(80).default(""),
  tradeIDs: z.array(z.string().max(200)).nullish()
});

/** Polymarket's order rejection messages, mapped to codes the app can explain. */
export function orderRejectionCode(message: string, status = ""): string {
  if (status === "unmatched") return "unmatched";
  const known: Record<string, string> = {
    "the market is not yet ready to process new orders": "market_not_ready",
    "invalid expiration": "invalid_expiration",
    "invalid post-only order: order crosses book": "post_only_would_cross",
    "post-only mode: only post-only orders and cancels are allowed": "post_only_mode",
    "order couldn't be fully filled. FOK orders are fully filled or killed.": "fok_not_filled",
    "no orders found to match with FAK order. FAK orders are partially filled or killed if no match is found.": "fak_not_filled"
  };
  if (known[message]) return known[message];
  if (message.includes("not enough balance / allowance")) return "insufficient_balance";
  return "order_rejected";
}

const decimalOut = (value: string) => (value === "" ? "0" : value);

/**
 * Post a signed order. `signature` is the owner's raw signature over
 * `typedData`; it is checked against the owner, then wrapped here, so a
 * signature for any other order or wallet never reaches the CLOB.
 */
export async function postOrder(input: { session: ClobSession; built: BuiltOrder; signature: string; postOnly?: boolean }, options: RequestOptions = {}): Promise<PostedOrder> {
  const { session, built } = input;
  const { order } = built;
  if (getAddress(order.maker) !== depositWalletAddress(session.ownerAddress)) throw invalid("This order is not for this owner's wallet.");
  if (input.postOnly && built.orderType !== "GTC" && built.orderType !== "GTD") throw invalid("Only resting orders can be post-only.");
  await assertOwnerSignature(built.typedData, input.signature, session.ownerAddress);
  const signature = wrapOrderSignature(built.typedData, input.signature);
  const body = {
    deferExec: false,
    order: {
      builder: order.builder, expiration: order.expiration, maker: order.maker, makerAmount: order.makerAmount, metadata: order.metadata,
      salt: Number(order.salt), side: order.side, signature, signatureType: order.signatureType, signer: order.signer,
      takerAmount: order.takerAmount, timestamp: order.timestamp, tokenId: order.tokenId
    },
    orderType: built.orderType,
    owner: session.credentials.key,
    ...(input.postOnly ? { postOnly: true } : {})
  };
  if (!Number.isSafeInteger(body.order.salt)) throw invalid("Invalid order salt.");
  let response: z.output<typeof postResponse>;
  try {
    response = await polymarketRequest({ service: "clob", method: "POST", path: "/order", body, sign: clobSigner(session), schema: postResponse, fetcher: options.fetcher });
  } catch (error) {
    if (error instanceof VenueError && error.code === "rejected") throw new VenueError("polymarket", orderRejectionCode(error.message), error.message, 422);
    throw error;
  }
  const status = response.status;
  if (!response.success || response.errorMsg !== "" || response.orderID === "" || (status !== "live" && status !== "matched" && status !== "delayed")) {
    const message = response.errorMsg || "Polymarket did not accept the order.";
    throw new VenueError("polymarket", orderRejectionCode(message, status), message, 422);
  }
  return { orderId: response.orderID, status, makingAmount: decimalOut(response.makingAmount), takingAmount: decimalOut(response.takingAmount), tradeIds: response.tradeIDs ?? [] };
}

const cancelResponse = z.object({ canceled: z.array(z.string().max(200)).default([]), not_canceled: z.record(z.string(), z.string().max(1_000)).nullish() });

/** Cancel one resting order. The answer says whether the CLOB canceled it and, if not, why. */
export async function cancelOrder(input: { session: ClobSession; orderId: string }, options: RequestOptions = {}): Promise<{ canceled: boolean; reason: string | null }> {
  if (!/^0x[\da-fA-F]{1,128}$/.test(input.orderId)) throw invalid("Unknown order.");
  const result = await polymarketRequest({
    service: "clob", method: "DELETE", path: "/order", body: { orderID: input.orderId },
    sign: clobSigner(input.session), schema: cancelResponse, fetcher: options.fetcher
  });
  const canceled = result.canceled.some((id) => id.toLowerCase() === input.orderId.toLowerCase());
  return { canceled, reason: canceled ? null : Object.values(result.not_canceled ?? {})[0] ?? "Not canceled." };
}

export type OpenOrder = {
  id: string;
  status: string;
  conditionId: string;
  tokenId: string;
  outcome: string;
  side: OrderSide;
  price: number;
  originalSize: number;
  sizeMatched: number;
  orderType: string;
  createdAt: number | null;
  expiration: number | null;
};

const openOrderSchema = z.object({
  id: z.string().max(200),
  status: z.string().max(40),
  market: z.string().max(80),
  asset_id: z.string().regex(/^\d{1,78}$/),
  outcome: z.string().max(300).default(""),
  side: z.enum(["BUY", "SELL"]),
  price: numeric,
  original_size: numeric,
  size_matched: numeric,
  order_type: z.string().max(10).default(""),
  created_at: numeric.nullish(),
  expiration: numeric.nullish()
});
const openOrdersPage = z.object({ data: z.array(z.unknown()).max(1_000), next_cursor: z.string().max(500).nullish() });
const END_CURSOR = "LTE=";

/** The owner's resting orders, optionally for one market (condition id) or outcome token. */
export async function openOrders(input: { session: ClobSession; market?: string; tokenId?: string }, options: RequestOptions = {}): Promise<OpenOrder[]> {
  if (input.market !== undefined && !/^0x[\da-fA-F]{64}$/.test(input.market)) throw invalid("Unknown market.");
  if (input.tokenId !== undefined && !/^\d{1,78}$/.test(input.tokenId)) throw invalid("Unknown outcome.");
  const orders: OpenOrder[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 10; page += 1) {
    const result = await polymarketRequest({
      service: "clob", path: "/data/orders", query: { market: input.market, asset_id: input.tokenId, next_cursor: cursor },
      sign: clobSigner(input.session), schema: openOrdersPage, maxBytes: 2_000_000, fetcher: options.fetcher
    });
    for (const raw of result.data) {
      const parsed = openOrderSchema.safeParse(raw);
      if (!parsed.success) throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unexpected order.");
      const item = parsed.data;
      orders.push({
        id: item.id, status: item.status, conditionId: item.market, tokenId: item.asset_id, outcome: item.outcome, side: item.side,
        price: item.price, originalSize: item.original_size, sizeMatched: item.size_matched, orderType: item.order_type,
        createdAt: item.created_at ?? null, expiration: item.expiration ? item.expiration : null
      });
    }
    if (!result.next_cursor || result.next_cursor === END_CURSOR) return orders;
    cursor = result.next_cursor;
  }
  return orders;
}

export type MarketQuote = {
  /** The price to sign: the worst level needed, moved by the slippage cap, on the tick grid. */
  limitPrice: number;
  /** The worst book level the order needs right now. */
  worstPrice: number;
  averagePrice: number;
  /** Shares received (buy) or sold (sell). */
  shares: number;
  /** pUSD spent (buy) or received (sell), before fees. */
  quote: number;
  /** Estimated taker fee in pUSD, when fee terms are given. */
  fee: number | null;
};

/**
 * Price a market order from the current book: walk the asks (buy, by pUSD
 * to spend) or bids (sell, by shares) best first, refuse when the book
 * cannot fill it, and cap the signed price at `slippageBps` past the worst
 * level used. The CLOB fills at the best prices available up to that cap.
 */
export function quoteMarketOrder(input: {
  book: OrderBook;
  side: OrderSide;
  /** pUSD for a buy, shares for a sell. */
  amount: number;
  slippageBps?: number;
  fee?: { rate: number; exponent: number };
}): MarketQuote {
  const slippageBps = input.slippageBps ?? 200;
  if (!Number.isFinite(input.amount) || input.amount <= 0) throw invalid("Invalid amount.");
  if (!Number.isInteger(slippageBps) || slippageBps < 0 || slippageBps > 5_000) throw invalid("Invalid slippage.");
  const levels = input.side === "BUY" ? input.book.asks : input.book.bids;
  let remaining = input.amount, shares = 0, quote = 0, fee = 0, worst: number | null = null;
  for (const level of levels) {
    if (remaining <= 1e-9) break;
    const take = input.side === "BUY" ? Math.min(remaining, level.price * level.size) : Math.min(remaining, level.size);
    const takenShares = input.side === "BUY" ? take / level.price : take;
    shares += takenShares;
    quote += input.side === "BUY" ? take : take * level.price;
    if (input.fee) fee += takenShares * input.fee.rate * (level.price * (1 - level.price)) ** input.fee.exponent;
    remaining -= take;
    worst = level.price;
  }
  if (worst === null || remaining > 1e-9) throw new VenueError("polymarket", "insufficient_liquidity", "There is not enough on the order book to fill this right now.", 409);
  const tick = BigInt(Math.round(input.book.tickSize * 1e6));
  const worstMicro = BigInt(Math.round(worst * 1e6));
  const unit = 10_000n * tick;
  const limitMicro = input.side === "BUY"
    ? [SCALE - tick, ((worstMicro * BigInt(10_000 + slippageBps) + unit - 1n) / unit) * tick].reduce((a, b) => (a < b ? a : b))
    : [tick, ((worstMicro * BigInt(10_000 - slippageBps)) / unit) * tick].reduce((a, b) => (a > b ? a : b));
  return { limitPrice: Number(limitMicro) / 1e6, worstPrice: worst, averagePrice: quote / shares, shares, quote, fee: input.fee ? fee : null };
}

export type DollarBuy = {
  built: BuiltOrder;
  /** pUSD spent on shares, before fees. */
  amount: number;
  /** Shares the current book gives for the amount. */
  estimatedShares: number;
  /** Shares guaranteed at the signed (slippage-capped) price. */
  minimumShares: number;
  averagePrice: number;
  limitPrice: number;
  /** Estimated taker fee in pUSD, charged on top of `amount`, when fee terms are given. */
  fee: number | null;
  /** pUSD paid out if the outcome wins: each share pays $1. */
  payoutIfWins: number;
  minimumPayoutIfWins: number;
};

/**
 * Buy an outcome by dollars: price `amountUsd` of pUSD against the outcome's
 * current book, then build a marketable FAK (default) or FOK buy capped at
 * `slippageBps` past the worst level needed. Reports the estimated shares
 * and what they pay if the outcome wins (shares × $1). Tick size and neg
 * risk come from the book unless given.
 */
export function buildDollarBuy(input: {
  wallet: string;
  book: OrderBook;
  amountUsd: number;
  slippageBps?: number;
  orderType?: "FAK" | "FOK";
  negRisk?: boolean;
  fee?: { rate: number; exponent: number };
  builderCode?: `0x${string}`;
  now?: Date;
  /** For tests only. */
  salt?: bigint;
}): DollarBuy {
  if (!Number.isFinite(input.amountUsd) || input.amountUsd < MIN_MARKET_BUY_PUSD) {
    throw new VenueError("polymarket", "below_minimum", `The minimum is ${MIN_MARKET_BUY_PUSD} pUSD.`, 400);
  }
  const amount = Math.floor(input.amountUsd * 100) / 100;
  const tickSize = input.book.tickSize;
  if (!(TICK_SIZES as readonly number[]).includes(tickSize)) throw new VenueError("polymarket", "invalid_response", "Polymarket sent an unknown tick size.");
  const quote = quoteMarketOrder({ book: input.book, side: "BUY", amount, slippageBps: input.slippageBps, fee: input.fee });
  const built = buildOrder({
    wallet: input.wallet, tokenId: input.book.tokenId, side: "BUY", price: quote.limitPrice, negRisk: input.negRisk ?? input.book.negRisk,
    tickSize, amount: amount.toFixed(2), orderType: input.orderType ?? "FAK", builderCode: input.builderCode, now: input.now, salt: input.salt
  });
  const minimumShares = Number(BigInt(built.order.takerAmount)) / 1e6;
  const estimatedShares = Math.floor(quote.shares * 100) / 100;
  return {
    built, amount, estimatedShares, minimumShares, averagePrice: quote.averagePrice, limitPrice: quote.limitPrice,
    fee: quote.fee === null ? null : Math.ceil(quote.fee * 1e6) / 1e6,
    payoutIfWins: estimatedShares, minimumPayoutIfWins: minimumShares
  };
}
