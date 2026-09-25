import { encodeFunctionData, erc20Abi, getAddress, isAddress, isHex, parseUnits } from "viem";
import { z } from "zod";
import type { CatalogAsset } from "@/lib/swap/assets";
import type { Call, Effect } from "./types";

/** The LI.FI Diamond has the same address on every chain LI.FI supports. */
export const LIFI_DIAMOND = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const QUOTE_TTL_MS = 45_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const NATIVE = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);

const token = z.object({ address: z.string(), chainId: z.number().int(), decimals: z.number().int(), symbol: z.string() });
const cost = z.object({ amountUSD: z.string().optional() }).passthrough();
const quoteSchema = z.object({
  id: z.string().min(1).max(200),
  tool: z.string().regex(/^[\w-]{1,80}$/),
  action: z.object({
    fromChainId: z.number().int(), toChainId: z.number().int(), fromToken: token, toToken: token,
    fromAmount: z.string().regex(/^\d+$/), fromAddress: z.string(), toAddress: z.string(), slippage: z.number().min(0).max(1)
  }).passthrough(),
  estimate: z.object({
    fromAmount: z.string().regex(/^\d+$/), toAmount: z.string().regex(/^\d+$/), toAmountMin: z.string().regex(/^\d+$/),
    approvalAddress: z.string().optional(), fromAmountUSD: z.string().optional(), toAmountUSD: z.string().optional(),
    gasCosts: z.array(cost).optional(), feeCosts: z.array(cost).optional()
  }).passthrough(),
  transactionRequest: z.object({ to: z.string(), data: z.string(), value: z.string(), chainId: z.number().int(), from: z.string().optional() }).passthrough()
}).passthrough();

export type RouteQuoteRequest = {
  from: CatalogAsset; to: CatalogAsset; amount: string; wallet: string; recipient: string; slippageBps: number;
};

export type ValidatedRoute = {
  tool: string; fromAmountRaw: string; toAmountRaw: string; toAmountMinRaw: string; expiresAt: string;
  calls: Call[]; effects: Effect[];
  economics: { fromAmountUsd: string | null; toAmountUsd: string | null; networkFeeUsd: number | null; providerFeeUsd: number | null; priceImpactPercent: number | null };
};

export class RouteQuoteError extends Error {
  readonly code: "invalid_request" | "no_route" | "provider_unavailable";
  constructor(code: RouteQuoteError["code"], message: string) { super(message); this.name = "RouteQuoteError"; this.code = code; }
}

function sameToken(provided: z.infer<typeof token>, asset: CatalogAsset): boolean {
  const address = NATIVE.has(provided.address.toLowerCase()) ? null : provided.address.toLowerCase();
  return provided.chainId === asset.chainId && provided.decimals === asset.decimals && address === asset.address;
}

function usdTotal(costs: Array<{ amountUSD?: string }> | undefined): number | null {
  if (!costs) return null;
  let total = 0;
  for (const item of costs) {
    const value = Number(item.amountUSD);
    if (item.amountUSD === undefined || !Number.isFinite(value) || value < 0) return null;
    total += value;
  }
  return total;
}

function priceImpact(fromUsd?: string, toUsd?: string): number | null {
  const from = Number(fromUsd); const to = Number(toUsd);
  if (fromUsd === undefined || toUsd === undefined || !Number.isFinite(from) || !Number.isFinite(to) || from <= 0 || to < 0) return null;
  return Math.max(0, (from - to) / from * 100);
}

/**
 * Check a LI.FI quote against the request and turn it into the calls and
 * effects of a route action. Aura does not decode bridge calldata: it pins
 * the call target and spender to the LI.FI Diamond, and confirms the outcome
 * from chain evidence afterwards.
 */
export function validateRoute(response: unknown, request: RouteQuoteRequest, now: number): ValidatedRoute | null {
  const parsed = quoteSchema.safeParse(response);
  if (!parsed.success) return null;
  const quote = parsed.data;
  const raw = parseUnits(request.amount, request.from.decimals);
  const { action, estimate, transactionRequest: tx } = quote;
  if (action.fromChainId !== request.from.chainId || action.toChainId !== request.to.chainId
    || !sameToken(action.fromToken, request.from) || !sameToken(action.toToken, request.to)
    || BigInt(action.fromAmount) !== raw || BigInt(estimate.fromAmount) !== raw
    || !isAddress(action.fromAddress) || !isAddress(action.toAddress)
    || getAddress(action.fromAddress) !== getAddress(request.wallet) || getAddress(action.toAddress) !== getAddress(request.recipient)
    || Math.abs(action.slippage - request.slippageBps / 10_000) > 1e-9) return null;
  const toAmount = BigInt(estimate.toAmount);
  const toAmountMin = BigInt(estimate.toAmountMin);
  if (toAmount <= 0n || toAmountMin <= 0n || toAmountMin > toAmount) return null;
  if (!isAddress(tx.to) || tx.to.toLowerCase() !== LIFI_DIAMOND || tx.chainId !== request.from.chainId
    || (tx.from && (!isAddress(tx.from) || getAddress(tx.from) !== getAddress(request.wallet)))
    || !isHex(tx.data, { strict: true }) || tx.data.length < 10 || tx.data.length % 2 !== 0 || !/^(0x[\da-f]+|\d+)$/i.test(tx.value)) return null;
  const value = BigInt(tx.value);
  const native = request.from.address === null;
  if (value !== (native ? raw : 0n)) return null;
  if (!native && (!estimate.approvalAddress || estimate.approvalAddress.toLowerCase() !== LIFI_DIAMOND)) return null;
  const impact = priceImpact(estimate.fromAmountUSD, estimate.toAmountUSD);
  const unverified = request.from.verification === "unverified" || request.to.verification === "unverified";
  if (impact !== null && impact > (unverified ? 1 : 3)) return null;
  if (unverified && impact === null) return null;

  const main: Call = { to: LIFI_DIAMOND, value: value.toString(), data: tx.data.toLowerCase() as `0x${string}` };
  const calls: Call[] = native ? [main] : [{
    to: request.from.address!.toLowerCase() as `0x${string}`, value: "0",
    data: encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [LIFI_DIAMOND, raw] })
  }, main];
  const recipient = request.recipient.toLowerCase() as `0x${string}`;
  const effects: Effect[] = [];
  if (!native) effects.push({ type: "erc20_debit", token: request.from.address!.toLowerCase() as `0x${string}`, amountRaw: raw.toString() });
  if (request.from.chainId !== request.to.chainId) {
    effects.push({ type: "delivery", tool: quote.tool.toLowerCase(), destinationChainId: request.to.chainId,
      token: request.to.address?.toLowerCase() as `0x${string}` | undefined ?? null, to: recipient, minimumRaw: toAmountMin.toString() });
  } else if (request.to.address) {
    effects.push({ type: "erc20_credit_min", token: request.to.address.toLowerCase() as `0x${string}`, to: recipient, minimumRaw: toAmountMin.toString() });
  }
  return {
    tool: quote.tool.toLowerCase(), fromAmountRaw: raw.toString(), toAmountRaw: toAmount.toString(), toAmountMinRaw: toAmountMin.toString(),
    expiresAt: new Date(now + QUOTE_TTL_MS).toISOString(), calls, effects,
    economics: { fromAmountUsd: estimate.fromAmountUSD ?? null, toAmountUsd: estimate.toAmountUSD ?? null,
      networkFeeUsd: usdTotal(estimate.gasCosts), providerFeeUsd: usdTotal(estimate.feeCosts), priceImpactPercent: impact }
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new RouteQuoteError("provider_unavailable", "The route provider returned an invalid response.");
  return JSON.parse(text) as unknown;
}

/** Ask LI.FI for the best route. The integrator fee, if configured, is Aura's revenue. */
export async function quoteRoute(request: RouteQuoteRequest, dependencies: { fetcher?: typeof fetch; now?: () => number } = {}): Promise<ValidatedRoute> {
  if (request.from.id === request.to.id) throw new RouteQuoteError("invalid_request", "Choose two different assets.");
  if (request.from.eligibility !== "eligible" || request.to.eligibility !== "eligible")
    throw new RouteQuoteError("invalid_request", "One of these assets isn't available.");
  if ((request.amount.split(".")[1]?.length ?? 0) > request.from.decimals) throw new RouteQuoteError("invalid_request", "Too many decimal places.");
  const raw = parseUnits(request.amount, request.from.decimals);
  if (raw <= 0n) throw new RouteQuoteError("invalid_request", "Enter an amount greater than zero.");
  const query = new URLSearchParams({
    fromChain: String(request.from.chainId), toChain: String(request.to.chainId),
    fromToken: request.from.address ?? "0x0000000000000000000000000000000000000000",
    toToken: request.to.address ?? "0x0000000000000000000000000000000000000000",
    fromAddress: request.wallet, toAddress: request.recipient, fromAmount: raw.toString(),
    slippage: String(request.slippageBps / 10_000), order: "CHEAPEST", allowDestinationCall: "false",
    integrator: process.env.LIFI_INTEGRATOR ?? "aurel"
  });
  const fee = Number(process.env.LIFI_INTEGRATOR_FEE ?? "0");
  if (Number.isFinite(fee) && fee > 0 && fee < 0.01) query.set("fee", String(fee));
  let response: Response;
  try {
    response = await (dependencies.fetcher ?? fetch)(`https://li.quest/v1/quote?${query}`, {
      headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined,
      signal: AbortSignal.timeout(12_000)
    });
  } catch { throw new RouteQuoteError("provider_unavailable", "The route provider is unavailable right now."); }
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new RouteQuoteError("no_route", "No route is available for this amount right now.");
  }
  let body: unknown;
  try { body = await readBoundedJson(response); }
  catch { throw new RouteQuoteError("provider_unavailable", "The route provider returned an invalid response."); }
  const route = validateRoute(body, request, (dependencies.now ?? Date.now)());
  if (!route) throw new RouteQuoteError("no_route", "No route passed Aura's checks for this amount right now.");
  return route;
}
