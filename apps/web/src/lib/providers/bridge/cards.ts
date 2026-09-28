import { z } from "zod";
import type { BridgeClient } from "./client";

/**
 * Bridge approves a verified customer for cards (the `cards` endorsement) and
 * then creates their Stripe cardholder. An approval lasts 24 hours unless a
 * card is created, after which the customer re-confirms their details.
 */
const customerSchema = z.object({
  id: z.string(),
  stripe_cardholder_id: z.string().nullable().optional(),
  endorsements: z.array(z.object({ name: z.string(), status: z.string(),
    requirements: z.object({ issues: z.array(z.unknown()).nullable().optional() }).passthrough().optional() }).passthrough()).optional()
}).passthrough();

export type CardsApproval = { status: "approved" | "incomplete" | "revoked" | "none"; cardholderId: string | null; issues: string[] };

export async function readCardsApproval(bridge: BridgeClient, customerId: string): Promise<CardsApproval> {
  const customer = await bridge.request(`/customers/${encodeURIComponent(customerId)}`, customerSchema);
  const cards = customer.endorsements?.find((item) => item.name === "cards");
  const status = cards?.status === "approved" || cards?.status === "incomplete" || cards?.status === "revoked" ? cards.status : "none";
  const issues = (cards?.requirements?.issues ?? []).map((issue) => typeof issue === "string" ? issue : JSON.stringify(issue)).slice(0, 10);
  return { status, cardholderId: status === "approved" ? customer.stripe_cardholder_id ?? null : null, issues };
}

/** A short-lived Bridge link where the customer applies for cards, or re-confirms their details. Not stored. */
export async function cardsApplicationLink(bridge: BridgeClient, customerId: string): Promise<string> {
  return (await bridge.request(`/customers/${encodeURIComponent(customerId)}/kyc_link?endorsement=cards`, z.object({ url: z.url() }).passthrough())).url;
}
