import { z } from "zod";
import { parseUnits } from "viem";
import { USDC_BY_CHAIN } from "@/config/chains";

export const routeRequestSchema = z.object({
  fromChainId: z.coerce.number().int(),
  toChainId: z.coerce.number().int(),
  amount: z.string().regex(/^\d+(\.\d{1,6})?$/),
  fromAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  toAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/).optional()
}).refine((value) => value.fromChainId !== value.toChainId, { message: "Choose two different networks." })
  .refine((value) => value.fromChainId in USDC_BY_CHAIN && value.toChainId in USDC_BY_CHAIN, { message: "This network pair is not supported." });

const tokenSchema = z.object({ symbol: z.string(), decimals: z.number(), chainId: z.number(), address: z.string() });
const quoteSchema = z.object({
  id: z.string(), tool: z.string(),
  action: z.object({ fromChainId: z.number(), toChainId: z.number(), fromToken: tokenSchema, toToken: tokenSchema }),
  estimate: z.object({ fromAmount: z.string(), toAmount: z.string(), toAmountMin: z.string(), executionDuration: z.number().optional(), approvalAddress: z.string().optional(), feeCosts: z.array(z.unknown()).optional(), gasCosts: z.array(z.unknown()).optional() }),
  transactionRequest: z.object({ to: z.string().regex(/^0x[a-fA-F0-9]{40}$/), data: z.string().regex(/^0x[a-fA-F0-9]*$/), value: z.string(), chainId: z.number().optional() })
});

export type LifiQuote = z.infer<typeof quoteSchema>;

export async function getUsdcRoute(input: z.infer<typeof routeRequestSchema>) {
  const parsed = routeRequestSchema.parse(input);
  const from = USDC_BY_CHAIN[parsed.fromChainId as keyof typeof USDC_BY_CHAIN];
  const to = USDC_BY_CHAIN[parsed.toChainId as keyof typeof USDC_BY_CHAIN];
  const rawAmount = parseUnits(parsed.amount, 6).toString();
  const query = new URLSearchParams({ fromChain: String(parsed.fromChainId), toChain: String(parsed.toChainId), fromToken: from.address, toToken: to.address, fromAddress: parsed.fromAddress, toAddress: parsed.toAddress ?? parsed.fromAddress, fromAmount: rawAmount, order: "CHEAPEST", slippage: "0.005", integrator: "aurel", allowDestinationCall: "false", maxPriceImpact: "0.02" });
  const response = await fetch(`https://li.quest/v1/quote?${query}`, { headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined, signal: AbortSignal.timeout(15_000) });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string } | null;
    throw new Error(body?.message ?? `Routing service returned ${response.status}.`);
  }
  const quote = quoteSchema.parse(await response.json());
  if (quote.action.fromChainId !== parsed.fromChainId || quote.action.toChainId !== parsed.toChainId) throw new Error("The route did not match the requested networks.");
  if (quote.action.fromToken.address.toLowerCase() !== from.address.toLowerCase() || quote.action.toToken.address.toLowerCase() !== to.address.toLowerCase()) throw new Error("The route did not match the requested assets.");
  if (quote.transactionRequest.chainId && quote.transactionRequest.chainId !== parsed.fromChainId) throw new Error("The route transaction is bound to an unexpected network.");
  return { quote, requestedAmount: parsed.amount, observedAt: new Date().toISOString(), authority: "LI.FI live quote; settlement by selected bridge contracts" as const };
}
