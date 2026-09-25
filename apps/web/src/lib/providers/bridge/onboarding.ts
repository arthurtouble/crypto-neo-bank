import { z } from "zod";
import type { BridgeClient } from "./client";

const kycLinkSchema = z.object({
  id: z.string(),
  customer_id: z.string(),
  kyc_link: z.url(),
  tos_link: z.url(),
  kyc_status: z.string(),
  tos_status: z.string()
}).passthrough();

export type Onboarding = { customerId: string; kycLink: string; tosLink: string; kycStatus: string; tosStatus: string };

/** Start Bridge identity verification. Bridge hosts the KYC and terms pages and creates the customer. */
export async function startOnboarding(bridge: BridgeClient, input: { subject: string; fullName: string; email: string }): Promise<Onboarding> {
  const link = await bridge.request("/kyc_links", kycLinkSchema, {
    method: "POST", idempotencyKey: `kyc-link:${input.subject}`,
    body: { full_name: input.fullName, email: input.email, type: "individual" }
  });
  return { customerId: link.customer_id, kycLink: link.kyc_link, tosLink: link.tos_link, kycStatus: link.kyc_status, tosStatus: link.tos_status };
}
