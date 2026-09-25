import { z } from "zod";
import type { BridgeClient } from "./client";

const kycLinkSchema = z.object({
  id: z.string(),
  // Bridge creates the customer only once verification completes.
  customer_id: z.string().nullable(),
  kyc_link: z.url(),
  tos_link: z.url(),
  kyc_status: z.string(),
  tos_status: z.string()
}).passthrough();

export type Onboarding = { kycLinkId: string; customerId: string | null; kycLink: string; tosLink: string; kycStatus: string; tosStatus: string };

function fromLink(link: z.infer<typeof kycLinkSchema>): Onboarding {
  return { kycLinkId: link.id, customerId: link.customer_id, kycLink: link.kyc_link, tosLink: link.tos_link, kycStatus: link.kyc_status, tosStatus: link.tos_status };
}

async function sha256(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("").slice(0, 32);
}

/** Start Bridge identity verification. Bridge hosts the KYC and terms pages. */
export async function startOnboarding(bridge: BridgeClient, input: { subject: string; fullName: string; email: string }): Promise<Onboarding> {
  const body = { full_name: input.fullName, email: input.email, type: "individual" };
  // Bridge rejects a reused key with a different body, so the key follows the details.
  return fromLink(await bridge.request("/kyc_links", kycLinkSchema, {
    method: "POST", idempotencyKey: `kyc-link:${input.subject}:${await sha256(JSON.stringify(body))}`, body
  }));
}

/** Re-read a KYC link, to learn the customer ID once Bridge has created the customer. */
export async function readOnboarding(bridge: BridgeClient, kycLinkId: string): Promise<Onboarding> {
  return fromLink(await bridge.request(`/kyc_links/${encodeURIComponent(kycLinkId)}`, kycLinkSchema));
}
