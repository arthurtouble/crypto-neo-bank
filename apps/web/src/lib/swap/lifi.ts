import { z } from "zod";
import { formatUnits, parseUnits } from "viem";
import { SWAP_ASSET_IDS, SWAP_ASSETS, SWAP_CHAIN_ID } from "@/config/swap-assets";

export const swapQuoteRequestSchema = z.object({
  fromAssetId: z.enum(SWAP_ASSET_IDS),
  toAssetId: z.enum(SWAP_ASSET_IDS),
  amount: z.string().regex(/^\d+(\.\d{1,18})?$/),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  slippageBps: z.number().int().min(10).max(100).default(50)
}).refine((value) => value.fromAssetId !== value.toAssetId, { message: "Choose two different assets." });

const tokenSchema = z.object({ symbol: z.string(), decimals: z.number(), chainId: z.number(), address: z.string() });
const costSchema = z.object({ amountUSD: z.string().optional() }).passthrough();
const quoteSchema = z.object({
  id: z.string(), tool: z.string(),
  action: z.object({ fromChainId: z.number(), toChainId: z.number(), fromToken: tokenSchema, toToken: tokenSchema }),
  estimate: z.object({
    fromAmount: z.string(), toAmount: z.string(), toAmountMin: z.string(), executionDuration: z.number().optional(), approvalAddress: z.string().optional(),
    fromAmountUSD: z.string().optional(), toAmountUSD: z.string().optional(), feeCosts: z.array(costSchema).optional(), gasCosts: z.array(costSchema).optional()
  }),
  transactionRequest: z.object({ to: z.string().regex(/^0x[a-fA-F0-9]{40}$/), data: z.string().regex(/^0x[a-fA-F0-9]*$/), value: z.string(), chainId: z.number().optional() })
});

const providers = [
  { key: "nordstern", name: "Nordstern" },
  { key: "kyberswap", name: "KyberSwap" },
  { key: "1inch", name: "1inch" },
  { key: "sushiswap", name: "SushiSwap" }
] as const;

function usdCosts(items: Array<{ amountUSD?: string }> | undefined) {
  return (items ?? []).reduce((sum, item) => sum + (Number(item.amountUSD) || 0), 0);
}

async function providerQuote(provider: (typeof providers)[number], query: URLSearchParams) {
  const providerQuery = new URLSearchParams(query);
  providerQuery.set("allowExchanges", provider.key);
  const response = await fetch(`https://li.quest/v1/quote?${providerQuery}`, {
    headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined,
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) return null;
  const quote = quoteSchema.parse(await response.json());
  if (quote.tool !== provider.key) return null;
  return { providerName: provider.name, quote };
}

export async function getSwapQuotes(input: z.infer<typeof swapQuoteRequestSchema>) {
  const parsed = swapQuoteRequestSchema.parse(input);
  const from = SWAP_ASSETS[parsed.fromAssetId];
  const to = SWAP_ASSETS[parsed.toAssetId];
  const rawAmount = parseUnits(parsed.amount, from.decimals);
  if (rawAmount <= 0n) throw new Error("Enter an amount greater than zero.");
  const query = new URLSearchParams({
    fromChain: String(SWAP_CHAIN_ID), toChain: String(SWAP_CHAIN_ID), fromToken: from.address, toToken: to.address,
    fromAddress: parsed.fromAddress, toAddress: parsed.fromAddress, fromAmount: rawAmount.toString(), order: "CHEAPEST",
    slippage: String(parsed.slippageBps / 10_000), integrator: "aurel", allowDestinationCall: "false", maxPriceImpact: "0.03"
  });
  const settled = await Promise.allSettled(providers.map((provider) => providerQuote(provider, query)));
  const observedAt = new Date();
  const quotes = settled.flatMap((result) => result.status === "fulfilled" && result.value ? [result.value] : []).map(({ providerName, quote }) => {
    if (quote.action.fromChainId !== SWAP_CHAIN_ID || quote.action.toChainId !== SWAP_CHAIN_ID) throw new Error("A quote used an unexpected network.");
    if (quote.action.fromToken.address.toLowerCase() !== from.address.toLowerCase() || quote.action.toToken.address.toLowerCase() !== to.address.toLowerCase()) throw new Error("A quote used unexpected assets.");
    if (quote.transactionRequest.chainId && quote.transactionRequest.chainId !== SWAP_CHAIN_ID) throw new Error("A quote transaction used an unexpected network.");
    const fromUsd = Number(quote.estimate.fromAmountUSD);
    const toUsd = Number(quote.estimate.toAmountUSD);
    const valueLossPercent = fromUsd > 0 && Number.isFinite(toUsd) ? Math.max(0, ((fromUsd - toUsd) / fromUsd) * 100) : undefined;
    return {
      quoteId: quote.id,
      provider: quote.tool,
      providerName,
      fromAssetId: parsed.fromAssetId,
      toAssetId: parsed.toAssetId,
      fromAmount: parsed.amount,
      toAmount: formatUnits(BigInt(quote.estimate.toAmount), to.decimals),
      toAmountMin: formatUnits(BigInt(quote.estimate.toAmountMin), to.decimals),
      fromAmountUsd: Number.isFinite(fromUsd) ? fromUsd : undefined,
      toAmountUsd: Number.isFinite(toUsd) ? toUsd : undefined,
      valueDifferencePercent: valueLossPercent,
      networkFeeUsd: usdCosts(quote.estimate.gasCosts),
      approvalAddress: quote.estimate.approvalAddress,
      transactionRequest: quote.transactionRequest
    };
  }).sort((a, b) => Number(b.toAmountMin) - Number(a.toAmountMin));
  if (!quotes.length) throw new Error("No validated quote is currently available for this pair.");
  return {
    quotes,
    observedAt: observedAt.toISOString(),
    expiresAt: new Date(observedAt.getTime() + 45_000).toISOString(),
    comparedProviders: providers.length,
    authority: "Live LI.FI-routed quotes; settlement by the selected exchange contracts" as const
  };
}
