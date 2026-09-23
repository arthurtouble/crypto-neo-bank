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
const costSchema = z.object({
  name: z.string().optional(), amount: z.string().regex(/^\d+$/).optional(), amountUSD: z.string().optional(),
  percentage: z.string().optional(), included: z.boolean().optional(), token: tokenSchema.optional()
}).passthrough();
const actionSchema = z.object({
  fromChainId: z.number().int(), toChainId: z.number().int(), fromToken: tokenSchema, toToken: tokenSchema,
  fromAmount: z.string().regex(/^\d+$/), fromAddress: z.string(), toAddress: z.string(),
  slippage: z.number().finite().min(0).max(1)
}).strict();
const nestedActionSchema = actionSchema.extend({
  jitoBundle: z.boolean().optional(), integratorId: z.string().max(80).optional(),
  integratorFees: z.object({ feePercent: z.number().finite().min(0).max(1) }).passthrough().optional()
});
const nestedEstimateSchema = z.object({
  fromAmount: z.string().regex(/^\d+$/), toAmount: z.string().regex(/^\d+$/),
  toAmountMin: z.string().regex(/^\d+$/), feeCosts: z.array(costSchema).optional()
}).partial().passthrough();
const providerQuoteSchema = z.object({
  id: z.string().min(1).max(200),
  type: z.enum(["swap", "cross", "lifi"]).optional(),
  tool: z.string().min(1).max(80),
  action: actionSchema,
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
    from: z.string().optional(), to: z.string(), data: z.string(), value: z.string(), chainId: z.number().int(),
    gasLimit: z.string().optional(), gasPrice: z.string().optional(),
    maxFeePerGas: z.string().optional(), maxPriorityFeePerGas: z.string().optional()
  }).strict(),
  includedSteps: z.array(z.object({
    id: z.string().min(1).max(200), type: z.enum(["swap", "cross", "protocol"]), tool: z.string().min(1).max(80),
    action: nestedActionSchema.optional(), estimate: nestedEstimateSchema.optional()
  }).passthrough()).max(8).optional(),
  expiresAt: z.string().datetime().optional()
});

export type LifiRoutePolicy = {
  allowedTools: ReadonlySet<string>;
  allowedExchanges: ReadonlySet<string>;
  allowedBridges: ReadonlySet<string>;
  allowedTargets: ReadonlySet<string>;
  allowedApprovalTargets: ReadonlySet<string>;
};

export type ServerHeldLifiPlan = {
  fromAssetId: string; toAssetId: string; fromChainId: number; toChainId: number;
  fromAmountRaw: string; toAmountMinRaw: string; recipient: string; slippageBps: number;
  quoteId: string; stepId: string; toolId: string; approvalSpender: string | null;
  routeSteps: Array<{ id: string; type: "swap" | "cross" | "protocol"; tool: string;
    fromAssetId?: string; toAssetId?: string; fromAmountRaw?: string; toAmountRaw?: string; toAmountMinRaw?: string;
    slippage?: number; integratorFeePercent?: number }>;
  economics: { fromAmountUsd: string | null; toAmountUsd: string | null; toAmountRaw: string;
    networkFeeUsd: number | null; providerFeeUsd: number | null; totalFeeUsd: number | null;
    priceImpactPercent: number | null; feeCosts: Array<Pick<z.infer<typeof costSchema>, "name" | "amount" | "amountUSD" | "percentage" | "included" | "token">> | null };
  sourceCall: { chainId: number; from: string; to: string; value: string; data: string;
    providerGasLimit?: string; providerGasPrice?: string };
  routePolicyVersion: string; catalogVersion: string; observedAt: string; expiresAt: string; fingerprint: string;
};

export type LifiQuoteWithPlan = { quote: ValidatedSwapQuote; plan: ServerHeldLifiPlan };

type Dependencies = {
  fetcher?: typeof fetch;
  now?: () => number;
  policy?: LifiRoutePolicy;
};

function configuredSet(name: string): ReadonlySet<string> {
  return new Set((process.env[name] ?? "").split(",").map((value) => value.trim().toLowerCase()).filter(Boolean));
}

function configuredPolicy(): LifiRoutePolicy {
  return {
    allowedTools: configuredSet("AUREL_LIFI_ALLOWED_TOOLS"),
    allowedExchanges: configuredSet("AUREL_LIFI_ALLOWED_EXCHANGES"),
    allowedBridges: configuredSet("AUREL_LIFI_ALLOWED_BRIDGES"),
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

function providerTokenId(token: z.infer<typeof tokenSchema>): string | null {
  try { return assetId(token.chainId, NATIVE_SENTINELS.has(token.address.toLowerCase()) ? null : token.address); }
  catch { return null; }
}

function optionalUsdTotal(costs: Array<{ amountUSD?: string }> | undefined): number | null {
  if (!costs) return null;
  let total = 0;
  for (const cost of costs) {
    if (cost.amountUSD === undefined) return null;
    const value = Number(cost.amountUSD);
    if (!Number.isFinite(value) || value < 0) return null;
    total += value;
    if (!Number.isFinite(total)) return null;
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

function containsNestedExecution(value: unknown): boolean {
  const pending = [value];
  let inspected = 0;
  while (pending.length) {
    if (++inspected > 2_000) return true;
    const item = pending.pop();
    if (!item || typeof item !== "object") continue;
    for (const [key, child] of Object.entries(item)) {
      if (/call|transactionrequest|includedsteps|permit/i.test(key)) return true;
      if (child && typeof child === "object") pending.push(child);
    }
  }
  return false;
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
): Promise<LifiQuoteWithPlan | null> {
  const parsed = providerQuoteSchema.safeParse(value);
  if (!parsed.success) return null;
  const quote = parsed.data;
  let target: string;
  try { target = getAddress(quote.transactionRequest.to).toLowerCase(); } catch { return null; }
  if ((quote.type === "swap" && assets.from.chainId !== assets.to.chainId)
    || (quote.type === "cross" && assets.from.chainId === assets.to.chainId)) return null;
  if (quote.type === "lifi" && (assets.from.chainId !== assets.to.chainId || !quote.includedSteps?.length
    || quote.includedSteps.length !== 2 || quote.includedSteps[0].type !== "protocol"
    || quote.includedSteps[1].type !== "swap"
    || quote.includedSteps.some((step) => !step.action || !step.estimate))) return null;
  if (!policy.allowedTools.has(quote.tool.toLowerCase())) return null;
  if (!(assets.from.chainId === assets.to.chainId ? policy.allowedExchanges : policy.allowedBridges).has(quote.tool.toLowerCase())) return null;
  const routeSteps: ServerHeldLifiPlan["routeSteps"] = [];
  let cursorAssetId = assets.from.id as string;
  let cursorDecimals = assets.from.decimals;
  let cursorAmount = rawAmount;
  for (const step of quote.includedSteps ?? []) {
    if (containsNestedExecution(step)) return null;
    if (step.type === "protocol" && quote.type !== "lifi") return null;
    const stepTool = step.tool.toLowerCase();
    if (!policy.allowedTools.has(stepTool)
      || (step.type === "protocol" ? stepTool !== "feecollection"
        : !(step.type === "swap" ? policy.allowedExchanges : policy.allowedBridges).has(stepTool))) return null;
    if (step.action) {
      try {
        const expectedAddress = quote.type === "lifi" ? target : getAddress(input.fromAddress);
        if (getAddress(step.action.fromAddress).toLowerCase() !== expectedAddress.toLowerCase()
          || getAddress(step.action.toAddress).toLowerCase() !== expectedAddress.toLowerCase()) return null;
      } catch { return null; }
    }
    if (quote.type === "lifi") {
      const action = step.action!;
      const estimate = step.estimate!;
      if (!estimate.fromAmount || !estimate.toAmount || !estimate.toAmountMin) return null;
      const fromId = providerTokenId(action.fromToken);
      const toId = providerTokenId(action.toToken);
      if (!fromId || !toId || fromId !== cursorAssetId || action.fromChainId !== assets.from.chainId
        || action.toChainId !== assets.to.chainId || action.slippage > input.slippageBps / 10_000 + Number.EPSILON
        || action.fromToken.chainId !== action.fromChainId || action.toToken.chainId !== action.toChainId
        || action.fromToken.decimals !== cursorDecimals || action.toToken.decimals < 0 || action.toToken.decimals > 36
        || BigInt(action.fromAmount) !== cursorAmount
        || BigInt(estimate.fromAmount) !== cursorAmount) return null;
      const output = BigInt(estimate.toAmount);
      const minimum = BigInt(estimate.toAmountMin);
      if (output <= 0n || minimum <= 0n || minimum > output) return null;
      if (step.type === "protocol") {
        if (toId !== fromId || output > cursorAmount || !step.estimate?.feeCosts?.length
          || !quote.estimate.feeCosts?.some((fee) => fee.amount === (cursorAmount - output).toString()
            && fee.included === true && fee.token && providerTokenId(fee.token) === fromId)) return null;
        const fee = step.estimate.feeCosts;
        if (fee.some((cost) => !cost.amount || cost.included !== true || !cost.token || providerTokenId(cost.token) !== fromId)
          || fee.reduce((sum, cost) => sum + BigInt(cost.amount!), 0n) !== cursorAmount - output) return null;
        if (action.integratorFees) {
          const feeShare = BigInt(action.integratorFees.feePercent.toFixed(18).replace(".", ""));
          const expectedFee = cursorAmount * feeShare / 1_000_000_000_000_000_000n;
          const actualFee = cursorAmount - output;
          if (actualFee < expectedFee || actualFee > expectedFee + 1n) return null;
        }
      }
      routeSteps.push({ id: step.id, type: step.type, tool: step.tool, fromAssetId: fromId,
        toAssetId: toId, fromAmountRaw: cursorAmount.toString(), toAmountRaw: output.toString(),
        toAmountMinRaw: minimum.toString(), slippage: action.slippage,
        ...(action.integratorFees ? { integratorFeePercent: action.integratorFees.feePercent } : {}) });
      cursorAssetId = toId;
      cursorDecimals = action.toToken.decimals;
      cursorAmount = output;
    } else routeSteps.push({ id: step.id, type: step.type, tool: step.tool });
  }
  if (quote.type === "lifi" && (cursorAssetId !== assets.to.id || cursorDecimals !== assets.to.decimals
    || cursorAmount !== BigInt(quote.estimate.toAmount)
    || routeSteps.at(-1)?.toAmountMinRaw !== quote.estimate.toAmountMin)) return null;
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

  if (quote.transactionRequest.from) {
    try { if (getAddress(quote.transactionRequest.from) !== getAddress(input.fromAddress)) return null; } catch { return null; }
  }
  if (!policy.allowedTargets.has(target)) return null;
  if (quote.transactionRequest.chainId !== assets.from.chainId) return null;
  const providerGasLimit = quote.transactionRequest.gasLimit === undefined ? null : unsignedTransactionValue(quote.transactionRequest.gasLimit);
  const providerGasPrice = quote.transactionRequest.gasPrice === undefined ? null : unsignedTransactionValue(quote.transactionRequest.gasPrice);
  if (quote.transactionRequest.maxFeePerGas !== undefined || quote.transactionRequest.maxPriorityFeePerGas !== undefined
    || (quote.transactionRequest.gasLimit !== undefined && providerGasLimit === null)
    || (quote.transactionRequest.gasPrice !== undefined && providerGasPrice === null)
    || (quote.type !== "lifi" && (providerGasLimit !== null || providerGasPrice !== null))
    || (quote.type === "lifi" && ((providerGasLimit === null) !== (providerGasPrice === null)))
    || (providerGasLimit !== null && (providerGasLimit <= 0n || providerGasPrice === null || providerGasPrice <= 0n))) return null;
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
  const networkFeeUsd = optionalUsdTotal(quote.estimate.gasCosts);
  const providerFeeUsd = optionalUsdTotal(quote.estimate.feeCosts);
  const combinedFeeUsd = networkFeeUsd !== null && providerFeeUsd !== null ? networkFeeUsd + providerFeeUsd : null;
  const economics = {
    fromAmountUsd: quote.estimate.fromAmountUSD ?? null,
    toAmountUsd: quote.estimate.toAmountUSD ?? null,
    toAmountRaw: toAmount.toString(),
    networkFeeUsd, providerFeeUsd,
    totalFeeUsd: combinedFeeUsd !== null && Number.isFinite(combinedFeeUsd) ? combinedFeeUsd : null,
    priceImpactPercent,
    feeCosts: quote.estimate.feeCosts?.map(({ name, amount, amountUSD, percentage, included, token }) =>
      ({ name, amount, amountUSD, percentage, included, token })) ?? null
  };
  const unverified = assets.from.verification === "unverified" || assets.to.verification === "unverified";
  if ((unverified && priceImpactPercent === null) || (priceImpactPercent !== null && priceImpactPercent > (unverified ? 1 : 3))) return null;

  const routePolicyVersion = await sha256(JSON.stringify([
    ...[policy.allowedTools, policy.allowedExchanges, policy.allowedBridges, policy.allowedTargets, policy.allowedApprovalTargets]
      .map((set) => [...set].map((item) => item.toLowerCase()).sort())
  ]));
  const catalogVersion = await sha256(JSON.stringify([assets.from, assets.to]));
  const planHash = await sha256(JSON.stringify([
    quote.type ?? null, quote.tool, quote.id, input.fromAssetId, input.toAssetId, fromAmount.toString(), toAmount.toString(), toAmountMin.toString(),
    input.fromAddress.toLowerCase(), quote.action.toAddress.toLowerCase(), quote.action.slippage,
    assets.from.chainId, target, transactionValue.toString(), quote.transactionRequest.data.toLowerCase(),
    approvalTarget?.toLowerCase() ?? null, providerGasLimit?.toString() ?? null, providerGasPrice?.toString() ?? null,
    expiresAt, routePolicyVersion, catalogVersion, routeSteps, economics
  ]));
  const publicQuote: ValidatedSwapQuote = {
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
    networkFeeUsd,
    providerFeeUsd,
    totalFeeUsd: economics.totalFeeUsd,
    priceImpactPercent,
    approvalTarget,
    planReference: `lifi:${quote.id}:${planHash}`,
    routeKind: assets.from.chainId === assets.to.chainId ? "same_chain" : "cross_chain"
  };
  return { quote: publicQuote, plan: {
    fromAssetId: input.fromAssetId, toAssetId: input.toAssetId,
    fromChainId: assets.from.chainId, toChainId: assets.to.chainId,
    fromAmountRaw: fromAmount.toString(), toAmountMinRaw: toAmountMin.toString(),
    recipient: input.fromAddress.toLowerCase(), slippageBps: input.slippageBps,
    quoteId: quote.id, stepId: quote.id, toolId: quote.tool,
    approvalSpender: approvalTarget?.toLowerCase() ?? null,
    routeSteps, economics,
    sourceCall: { chainId: assets.from.chainId, from: input.fromAddress.toLowerCase(), to: target,
      value: transactionValue.toString(), data: quote.transactionRequest.data.toLowerCase(),
      ...(providerGasLimit !== null ? { providerGasLimit: providerGasLimit.toString(), providerGasPrice: providerGasPrice!.toString() } : {}) },
    routePolicyVersion, catalogVersion,
    observedAt: new Date(now).toISOString(), expiresAt, fingerprint: planHash
  } };
}

class LifiQuoteAdapter implements QuoteAdapter {
  constructor(private readonly dependencies: Required<Dependencies>) {}

  async quote(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]> {
    return (await this.quoteWithPlans(input, assets)).map(({ quote }) => quote);
  }

  async quoteWithPlans(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<LifiQuoteWithPlan[]> {
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
    const isBridge = from.data.chainId !== to.data.chainId;
    const allowedTools = isBridge ? this.dependencies.policy.allowedBridges : this.dependencies.policy.allowedExchanges;
    if (allowedTools.size === 0) {
      throw new SwapQuoteError("no_live_route", "No validated live route is currently available.");
    }
    for (const tool of [...(isBridge ? this.dependencies.policy.allowedBridges : new Set(["none"]))].map((value) => value.toLowerCase()).sort()) query.append("allowBridges", tool);
    const exchanges = this.dependencies.policy.allowedExchanges.size ? this.dependencies.policy.allowedExchanges : new Set(["none"]);
    for (const tool of [...exchanges].map((value) => value.toLowerCase()).sort()) query.append("allowExchanges", tool);
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
    const result = await validateQuote(body, input, { from: from.data, to: to.data }, rawAmount, this.dependencies.now(), this.dependencies.policy);
    if (!result) throw new SwapQuoteError("no_live_route", "No validated live route is currently available.");
    return [result];
  }
}

export function createLifiQuoteAdapter(dependencies: Dependencies = {}): LifiQuoteAdapter {
  return new LifiQuoteAdapter({
    fetcher: dependencies.fetcher ?? fetch,
    now: dependencies.now ?? Date.now,
    policy: dependencies.policy ?? configuredPolicy()
  });
}

export function getSwapQuotes(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]> {
  return createLifiQuoteAdapter().quote(input, assets);
}

export function getSwapQuotePlans(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<LifiQuoteWithPlan[]> {
  return createLifiQuoteAdapter().quoteWithPlans(input, assets);
}
