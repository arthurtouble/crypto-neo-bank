import { z } from "zod";
import type { ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

/** A provider's view of the customer: overall status, KYC and terms progress, and the customer ID once it exists. */
export const customerLinkEventSchema = z.object({
  status: z.string().max(40).optional(),
  kycStatus: z.string().max(40).optional(),
  tosStatus: z.string().max(40).optional(),
  customerId: z.string().min(1).max(200).optional()
}).strict().refine((value) => Object.values(value).some((item) => item !== undefined));

/**
 * Bridge customer statuses mapped to Aura's four. Bridge documents approval
 * as `active`, but some of its examples say `approved`; both count. Anything
 * unrecognised stays pending.
 */
export function linkStatus(providerStatus: string): "pending" | "active" | "rejected" | "closed" {
  if (providerStatus === "active" || providerStatus === "approved") return "active";
  if (providerStatus === "rejected") return "rejected";
  if (providerStatus === "offboarded" || providerStatus === "paused") return "closed";
  return "pending";
}

/** Update an existing link. A provider event never creates a link: onboarding does, from an authenticated session. */
export async function applyCustomerLink(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = customerLinkEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  const { status, kycStatus, tosStatus, customerId } = parsed.data;
  // A rejected KYC review rejects the link even before a customer status arrives.
  const mapped = status !== undefined ? linkStatus(status) : kycStatus === "rejected" ? "rejected" : null;
  const result = await db.prepare(`UPDATE provider_customer_links SET
      status = COALESCE(?, status), kyc_status = COALESCE(?, kyc_status), tos_status = COALESCE(?, tos_status),
      external_customer_id = COALESCE(external_customer_id, ?), observed_at = ?, updated_at = ?
    WHERE subject_reference = ? AND provider = ? AND (observed_at IS NULL OR observed_at <= ?)`)
    .bind(mapped, kycStatus ?? null, tosStatus ?? null, customerId ?? null, source.observedAt, source.observedAt,
      subjectReference, source.provider, source.observedAt).run();
  if (result.meta.changes) return { status: "applied", projection: "provider_customer_links" };
  const link = await db.prepare("SELECT 1 AS found FROM provider_customer_links WHERE subject_reference = ? AND provider = ?")
    .bind(subjectReference, source.provider).first();
  return link ? { status: "stale", projection: "provider_customer_links" } : { status: "ignored", reason: "unknown_subject" };
}
