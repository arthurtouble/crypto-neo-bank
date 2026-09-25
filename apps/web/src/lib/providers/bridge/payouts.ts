import { isAddress } from "viem";
import { z } from "zod";
import type { BridgeClient } from "./client";

const payoutSchema = z.object({
  id: z.string(),
  state: z.string(),
  source_deposit_instructions: z.object({
    payment_rail: z.literal("base"),
    currency: z.literal("usdc"),
    to_address: z.string().refine(isAddress),
    amount: z.string().regex(/^\d+(\.\d{1,6})?$/)
  }).passthrough()
}).passthrough();

export type Payout = { transferId: string; depositAddress: `0x${string}`; amount: string };

/**
 * Ask Bridge to pay a saved bank account. Bridge returns an address on Base;
 * sending exactly that USDC amount there, as an ordinary transfer action, funds the payout.
 */
export async function createPayout(bridge: BridgeClient, input: { customerId: string; externalAccountId: string; amountUsd: string;
  fromAddress: string; rail: "ach" | "wire"; requestId: string }): Promise<Payout> {
  const payout = await bridge.request("/transfers", payoutSchema, {
    method: "POST", idempotencyKey: `payout:${input.requestId}`,
    body: { on_behalf_of: input.customerId, amount: input.amountUsd,
      source: { payment_rail: "base", currency: "usdc", from_address: input.fromAddress },
      destination: { payment_rail: input.rail, currency: "usd", external_account_id: input.externalAccountId } }
  });
  if (payout.source_deposit_instructions.amount !== input.amountUsd) throw new Error("Bridge changed the payout amount.");
  return { transferId: payout.id, depositAddress: payout.source_deposit_instructions.to_address.toLowerCase() as `0x${string}`, amount: payout.source_deposit_instructions.amount };
}
