import { z } from "zod";
import type { ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

/** A provider's view of the customer's account: overall status, and KYC and terms progress. */
export const customerLinkEventSchema = z.object({
  status: z.string().max(40).optional(),
  kycStatus: z.string().max(40).optional(),
  tosStatus: z.string().max(40).optional()
}).strict().refine((value) => value.status !== undefined || value.kycStatus !== undefined || value.tosStatus !== undefined);

/** Bridge customer statuses mapped to Aura's four. Anything unrecognised stays pending. */
export function linkStatus(providerStatus: string): "pending" | "active" | "rejected" | "closed" {
  if (providerStatus === "active") return "active";
  if (providerStatus === "rejected") return "rejected";
  if (providerStatus === "offboarded" || providerStatus === "paused") return "closed";
  return "pending";
}

/** Update an existing link. A provider event never creates a link: onboarding does, from an authenticated session. */
export async function applyCustomerLink(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = customerLinkEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  const { status, kycStatus, tosStatus } = parsed.data;
  const result = await db.prepare(`UPDATE provider_customer_links SET
      status = COALESCE(?, status), kyc_status = COALESCE(?, kyc_status), tos_status = COALESCE(?, tos_status),
      observed_at = ?, updated_at = ?
    WHERE subject_reference = ? AND provider = ? AND (observed_at IS NULL OR observed_at <= ?)`)
    .bind(status === undefined ? null : linkStatus(status), kycStatus ?? null, tosStatus ?? null, source.observedAt, source.observedAt,
      subjectReference, source.provider, source.observedAt).run();
  if (result.meta.changes) return { status: "applied", projection: "provider_customer_links" };
  const link = await db.prepare("SELECT 1 AS found FROM provider_customer_links WHERE subject_reference = ? AND provider = ?")
    .bind(subjectReference, source.provider).first();
  return link ? { status: "stale", projection: "provider_customer_links" } : { status: "ignored", reason: "unknown_subject" };
}
