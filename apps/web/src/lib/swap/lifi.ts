import { getAddress, hexToBytes, parseUnits } from "viem";
import { z } from "zod";
import { assetId, catalogAssetSchema, parseAssetId, type CatalogAsset } from "@/lib/swap/assets";
import {
  requireExactUnverifiedAcknowledgements, SwapQuoteError, type QuoteAdapter, type SwapQuoteInput, type ValidatedSwapQuote
} from "@/lib/swap/quotes";

const QUOTE_TTL_MS = 45_000;
const MAX_QUOTE_RESPONSE_BYTES = 1_000_000;
const NATIVE_SENTINEL = "0x0000000000000000000000000000000000000000";
const NATIVE_SENTINELS = new Set([NATIVE_SENTINEL, "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
const MAX_UINT256 = (1n << 256n) - 1n;

const tokenSchema = z.object({
  symbol: z.string(), decimals: z.number().int(), chainId: z.number().int(), address: z.string()
});
const costSchema = z.object({ amountUSD: z.string().optional() }).passthrough();
const providerQuoteSchema = z.object({
  id: z.string().min(1).max(200),
  tool: z.string().min(1).max(80),
  action: z.object({
    fromChainId: z.number().int(), toChainId: z.number().int(), fromToken: tokenSchema, toToken: tokenSchema,
    fromAmount: z.string().regex(/^\d+$/), fromAddress: z.string(), toAddress: z.string(),
    slippage: z.number().finite().min(0).max(1)
  }),
  estimate: z.object({
    fromAmount: z.string().regex(/^\d+$/),
    toAmount: z.string().regex(/^\d+$/),
    toAmountMin: z.string().regex(/^\d+$/),
    approvalAddress: z.string().optional(),
    fromAmountUSD: z.string().optional(),
    toAmountUSD: z.string().optional(),
    gasCosts: z.array(costSchema).optional(),
    feeCosts: z.array(costSchema).optional()
  }),
  transactionRequest: z.object({
    to: z.string(), data: z.string(), value: z.string(), chainId: z.number().int()
  }),
  expiresAt: z.string().datetime().optional()
});

export type LifiRoutePolicy = {
  allowedTools: ReadonlySet<string>;
  allowedExchanges?: ReadonlySet<string>;
  allowedTargets: ReadonlySet<string>;
  allowedApprovalTargets: ReadonlySet<string>;
};

type Dependencies = {
  fetcher?: typeof fetch;
  now?: () => number;
  policy?: LifiRoutePolicy;
};

function configuredSet(name: string): ReadonlySet<string> {
  return new Set((process.env[name] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function configuredPolicy(): LifiRoutePolicy {
  const allowedTools = configuredSet("AUREL_LIFI_ALLOWED_TOOLS");
  return {
    allowedTools,
    allowedExchanges: allowedTools,
    allowedTargets: configuredSet("AUREL_SWAP_ALLOWED_TARGETS"),
    allowedApprovalTargets: configuredSet("AUREL_SWAP_ALLOWED_SPENDERS")
  };
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!Number.isFinite(declaredLength) || declaredLength < 0 || declaredLength > MAX_QUOTE_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new SwapQuoteError("quote_unavailable", "The quote provider returned an invalid response.");
  }
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_QUOTE_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("oversized");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new SwapQuoteError("quote_unavailable", "The quote provider returned an invalid response.");
  }
}

function providerAddress(asset: CatalogAsset): string {
  return asset.address ?? NATIVE_SENTINEL;
}

function matchesProviderToken(token: z.infer<typeof tokenSchema>, asset: CatalogAsset): boolean {
  try {
    const normalizedAddress = NATIVE_SENTINELS.has(token.address.toLowerCase()) ? null : token.address;
    return token.chainId === asset.chainId && token.decimals === asset.decimals && assetId(token.chainId, normalizedAddress) === asset.id;
  } catch {
    return false;
  }
}

function optionalUsdTotal(costs: Array<{ amountUSD?: string }> | undefined): number | null {
  if (!costs?.length) return null;
  let total = 0;
  for (const cost of costs) {
    if (cost.amountUSD === undefined) return null;
    const value = Number(cost.amountUSD);
    if (!Number.isFinite(value) || value < 0) return null;
    total += value;
  }
  return total;
}

function observedPriceImpact(fromUsdValue: string | undefined, toUsdValue: string | undefined): number | null {
  if (fromUsdValue === undefined || toUsdValue === undefined) return null;
  const fromUsd = Number(fromUsdValue);
  const toUsd = Number(toUsdValue);
  if (!Number.isFinite(fromUsd) || !Number.isFinite(toUsd) || fromUsd <= 0 || toUsd < 0) return null;
  return Math.round(Math.max(0, ((fromUsd - toUsd) / fromUsd) * 100) * 1_000_000) / 1_000_000;
}

function boundedExpiry(providerExpiry: string | undefined, now: number): string | null {
  const localExpiry = now + QUOTE_TTL_MS;
  if (!providerExpiry) return new Date(localExpiry).toISOString();
  const parsed = Date.parse(providerExpiry);
  if (!Number.isFinite(parsed) || parsed <= now) return null;
  return new Date(Math.min(parsed, localExpiry)).toISOString();
}

function unsignedTransactionValue(value: string): bigint | null {
  if (!/^(?:\d+|0x[\da-fA-F]+)$/.test(value)) return null;
  try {
    const parsed = BigInt(value);
    return parsed <= MAX_UINT256 ? parsed : null;
  } catch {
    return null;
  }
}

async function sha256(value: string): Promise<`0x${string}`> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return `0x${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}`;
}

async function validateQuote(
  value: unknown,
  input: SwapQuoteInput,
  assets: { from: CatalogAsset; to: CatalogAsset },
  rawAmount: bigint,
  now: number,
  policy: LifiRoutePolicy
): Promise<ValidatedSwapQuote | null> {
  const parsed = providerQuoteSchema.safeParse(value);
  if (!parsed.success) return null;
  const quote = parsed.data;
  if (!policy.allowedTools.has(quote.tool.toLowerCase())) return null;
  if (quote.action.fromChainId !== assets.from.chainId || quote.action.toChainId !== assets.to.chainId) return null;
  if (!matchesProviderToken(quote.action.fromToken, assets.from) || !matchesProviderToken(quote.action.toToken, assets.to)) return null;
  if (BigInt(quote.action.fromAmount) !== rawAmount || quote.action.slippage > input.slippageBps / 10_000 + Number.EPSILON) return null;
  try {
    if (getAddress(quote.action.fromAddress) !== getAddress(input.fromAddress)
      || getAddress(quote.action.toAddress) !== getAddress(input.fromAddress)) return null;
  } catch { return null; }

  const fromAmount = BigInt(quote.estimate.fromAmount);
  const toAmount = BigInt(quote.estimate.toAmount);
  const toAmountMin = BigInt(quote.estimate.toAmountMin);
  if (fromAmount !== rawAmount || toAmount <= 0n || toAmountMin <= 0n || toAmountMin > toAmount) return null;

  let target: string;
  try { target = getAddress(quote.transactionRequest.to).toLowerCase(); } catch { return null; }
  if (!policy.allowedTargets.has(target)) return null;
  if (quote.transactionRequest.chainId !== assets.from.chainId) return null;
  if (!/^0x(?:[a-fA-F0-9]{2})+$/.test(quote.transactionRequest.data)) return null;
  try { hexToBytes(quote.transactionRequest.data as `0x${string}`); } catch { return null; }
  const transactionValue = unsignedTransactionValue(quote.transactionRequest.value);
  if (transactionValue === null || transactionValue !== (assets.from.address === null ? rawAmount : 0n)) return null;

  let approvalTarget: string | null = null;
  if (quote.estimate.approvalAddress !== undefined) {
    if (assets.from.address === null) return null;
    try { approvalTarget = getAddress(quote.estimate.approvalAddress); } catch { return null; }
    if (!policy.allowedApprovalTargets.has(approvalTarget.toLowerCase())) return null;
  }

  const expiresAt = boundedExpiry(quote.expiresAt, now);
  if (!expiresAt) return null;
  const priceImpactPercent = observedPriceImpact(quote.estimate.fromAmountUSD, quote.estimate.toAmountUSD);
  const unverified = assets.from.verification === "unverified" || assets.to.verification === "unverified";
  if ((unverified && priceImpactPercent === null) || (priceImpactPercent !== null && priceImpactPercent > (unverified ? 1 : 3))) return null;

  const planHash = await sha256(JSON.stringify([
    quote.tool, quote.id, input.fromAssetId, input.toAssetId, fromAmount.toString(), toAmount.toString(), toAmountMin.toString(),
    input.fromAddress.toLowerCase(), quote.action.toAddress.toLowerCase(), quote.action.slippage,
    assets.from.chainId, target, transactionValue.toString(), quote.transactionRequest.data.toLowerCase(),
    approvalTarget?.toLowerCase() ?? null, expiresAt
  ]));
  return {
    provider: `lifi:${quote.tool}`,
    quoteId: quote.id,
    fromAssetId: input.fromAssetId,
    toAssetId: input.toAssetId,
    fromChainId: assets.from.chainId,
    toChainId: assets.to.chainId,
    fromAmountRaw: fromAmount.toString(),
    toAmountRaw: toAmount.toString(),
    toAmountMinRaw: toAmountMin.toString(),
    expiresAt,
    networkFeeUsd: optionalUsdTotal(quote.estimate.gasCosts),
    priceImpactPercent,
    approvalTarget,
    planReference: `lifi:${quote.id}:${planHash}`,
    routeKind: assets.from.chainId === assets.to.chainId ? "same_chain" : "cross_chain"
  };
}

class LifiQuoteAdapter implements QuoteAdapter {
  constructor(private readonly dependencies: Required<Dependencies>) {}

  async quote(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]> {
    if (!parseAssetId(input.fromAssetId) || !parseAssetId(input.toAssetId)) {
      throw new SwapQuoteError("unsupported_chain", "This asset chain is not supported.");
    }
    const from = catalogAssetSchema.safeParse(assets.from);
    const to = catalogAssetSchema.safeParse(assets.to);
    if (!from.success || !to.success || from.data.eligibility !== "eligible" || to.data.eligibility !== "eligible"
      || from.data.id !== input.fromAssetId || to.data.id !== input.toAssetId) {
      throw new SwapQuoteError("asset_unavailable", "One of these assets is not currently available for quotes.");
    }
    requireExactUnverifiedAcknowledgements(input, { from: from.data, to: to.data });
    let rawAmount: bigint;
    if ((input.amount.split(".")[1]?.length ?? 0) > from.data.decimals) {
      throw new SwapQuoteError("asset_unavailable", "The amount precision is not supported by the source asset.");
    }
    try { rawAmount = parseUnits(input.amount, from.data.decimals); } catch {
      throw new SwapQuoteError("asset_unavailable", "The amount precision is not supported by the source asset.");
    }
    if (rawAmount <= 0n) throw new SwapQuoteError("asset_unavailable", "Enter an amount greater than zero.");
    const unverified = from.data.verification === "unverified" || to.data.verification === "unverified";
    if (unverified && input.slippageBps > 50) throw new SwapQuoteError("asset_unavailable", "Unverified assets require slippage of 0.5% or less.");

    const query = new URLSearchParams({
      fromChain: String(from.data.chainId), toChain: String(to.data.chainId),
      fromToken: providerAddress(from.data), toToken: providerAddress(to.data),
      fromAddress: input.fromAddress, toAddress: input.fromAddress, fromAmount: rawAmount.toString(),
      order: "CHEAPEST", slippage: String(input.slippageBps / 10_000), integrator: "aurel",
      allowDestinationCall: "false", maxPriceImpact: String((unverified ? 1 : 3) / 100)
    });
    const allowedExchanges = this.dependencies.policy.allowedExchanges ?? this.dependencies.policy.allowedTools;
    if (allowedExchanges.size === 0) {
      throw new SwapQuoteError("no_live_route", "No validated live route is currently available.");
    }
    for (const exchange of [...allowedExchanges].map((value) => value.toLowerCase()).sort()) {
      query.append("allowExchanges", exchange);
    }
    let response: Response;
    try {
      response = await this.dependencies.fetcher(`https://li.quest/v1/quote?${query}`, {
        headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined,
        signal: AbortSignal.timeout(12_000)
      });
    } catch {
      throw new SwapQuoteError("quote_unavailable", "The quote provider is temporarily unavailable.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new SwapQuoteError("no_live_route", "No validated live route is currently available.");
    }
    const body = await readBoundedJson(response);
    const quote = await validateQuote(body, input, { from: from.data, to: to.data }, rawAmount, this.dependencies.now(), this.dependencies.policy);
    if (!quote) throw new SwapQuoteError("no_live_route", "No validated live route is currently available.");
    return [quote];
  }
}

export function createLifiQuoteAdapter(dependencies: Dependencies = {}): QuoteAdapter {
  return new LifiQuoteAdapter({
    fetcher: dependencies.fetcher ?? fetch,
    now: dependencies.now ?? Date.now,
    policy: dependencies.policy ?? configuredPolicy()
  });
}

export function getSwapQuotes(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]> {
  return createLifiQuoteAdapter().quote(input, assets);
}
