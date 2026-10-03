import { z } from "zod";

const decimal = z.string().regex(/^\d+(\.\d+)?$/).max(40);
const trigger = z.strictObject({ triggerPrice: decimal, limitPrice: decimal.optional() });

/** A dollar trade as the app sends it, for `previewPerpsTrade` and `placePerpsTrade`. */
export const perpsTradeSchema = z.strictObject({
  coin: z.string().min(1).max(60), side: z.enum(["long", "short"]), marginUsd: decimal, leverage: z.number().int().min(1).max(1_000),
  isCross: z.boolean(), type: z.enum(["market", "limit"]), limitPrice: decimal.optional(), takeProfit: trigger.optional(), stopLoss: trigger.optional()
}).refine((input) => input.type === "market" || input.limitPrice !== undefined, { message: "A limit order needs a price.", path: ["limitPrice"] });

export const positionTpslSchema = z.strictObject({ coin: z.string().min(1).max(60), takeProfit: trigger.optional(), stopLoss: trigger.optional() })
  .refine((input) => input.takeProfit || input.stopLoss, { message: "Set a take profit or a stop loss." });
