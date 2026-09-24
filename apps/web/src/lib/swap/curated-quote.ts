import { getAddress, parseUnits } from "viem";
import { z } from "zod";
import { curatedSwapAsset } from "./curated-assets";

export const curatedQuoteInput = z.object({
  fromAssetId: z.string(), toAssetId: z.string(), amount: z.string().regex(/^(?:0|[1-9]\d*)(?:\.\d+)?$/),
  walletAddress: z.string(), slippageBps: z.number().int().min(1).max(300).default(50)
});

export class CuratedQuoteError extends Error {
  constructor(readonly code: "invalid_asset" | "invalid_amount" | "provider_unavailable" | "no_route" | "invalid_quote", message: string) { super(message); }
}

export async function getCuratedLifiQuote(input: z.infer<typeof curatedQuoteInput>, fetcher: typeof fetch = fetch): Promise<Record<string, unknown>> {
  const from = curatedSwapAsset(input.fromAssetId);
  const to = curatedSwapAsset(input.toAssetId);
  if (!from || !to || from.id === to.id) throw new CuratedQuoteError("invalid_asset", "Choose two different available assets.");
  let amount: bigint;
  try { amount = parseUnits(input.amount, from.decimals); } catch { throw new CuratedQuoteError("invalid_amount", "Enter a valid amount."); }
  if (amount <= 0n) throw new CuratedQuoteError("invalid_amount", "Enter an amount above zero.");
  const walletAddress = getAddress(input.walletAddress);
  const params = new URLSearchParams({
    fromChain: String(from.chainId), toChain: String(to.chainId),
    fromToken: from.address ?? "0x0000000000000000000000000000000000000000",
    toToken: to.address ?? "0x0000000000000000000000000000000000000000",
    fromAmount: amount.toString(), fromAddress: walletAddress, toAddress: walletAddress,
    slippage: String(input.slippageBps / 10_000), integrator: "aurel", order: "CHEAPEST", allowDestinationCall: "false"
  });
  let response: Response;
  try { response = await fetcher(`https://li.quest/v1/quote?${params}`, { headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined, signal: AbortSignal.timeout(15_000) }); }
  catch { throw new CuratedQuoteError("provider_unavailable", "Quotes are temporarily unavailable. Try again."); }
  if (!response.ok) throw new CuratedQuoteError("no_route", "No route is available for this pair and amount.");
  const quote = await response.json() as Record<string, unknown>;
  const action = quote.action as Record<string, unknown> | undefined;
  const fromToken = action?.fromToken as Record<string, unknown> | undefined;
  const toToken = action?.toToken as Record<string, unknown> | undefined;
  const normalized = (value: unknown) => String(value ?? "").toLowerCase();
  const matches = (actual: Record<string, unknown> | undefined, asset: typeof from) => !!asset && Number(actual?.chainId) === asset.chainId
    && (asset.address ? normalized(actual?.address) === asset.address : ["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"].includes(normalized(actual?.address)));
  if (!matches(fromToken, from) || !matches(toToken, to) || normalized(action?.fromAddress) !== walletAddress.toLowerCase()
    || normalized(action?.toAddress) !== walletAddress.toLowerCase() || String(action?.fromAmount) !== amount.toString()
    || typeof quote.id !== "string" || !quote.estimate || !quote.transactionRequest) {
    throw new CuratedQuoteError("invalid_quote", "The quote changed. Try again.");
  }
  return quote;
}
