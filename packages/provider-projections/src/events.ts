import { applyCardAccount } from "./card-accounts";
import type { ProjectionDatabase } from "./database";
import { applyBenefitEntitlement, applyMembership } from "./memberships";
import type { ApplyResult, ProjectionSource } from "./source";
import { applyWalletPolicy } from "./wallet-policies";

/** The normalized provider event produced by the signed webhook route. */
export type ProviderEvent = {
  id: string; provider: string; type: string; subjectReference?: string;
  providerObjectId: string; createdAt: string; data: Record<string, unknown>;
};

type Adapter = (db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource) => Promise<ApplyResult>;

/** Which provider may report which projection. Anything else is ignored. */
export const projectionAdapters: Record<string, { providers: readonly string[]; apply: Adapter }> = {
  "card.account.updated": { providers: ["bridge", "rain"], apply: applyCardAccount },
  "membership.updated": { providers: ["bridge", "rain"], apply: applyMembership },
  "benefit.entitlement.updated": { providers: ["bridge", "rain"], apply: applyBenefitEntitlement },
  "wallet.policy.updated": { providers: ["privy"], apply: applyWalletPolicy }
};

/**
 * Apply a provider event to its projection. Returns "ignored" for events that
 * have no projection, so the consumer can acknowledge them instead of retrying.
 */
export async function applyProviderEvent(db: ProjectionDatabase, event: ProviderEvent): Promise<ApplyResult> {
  const adapter = projectionAdapters[event.type];
  if (!adapter || !adapter.providers.includes(event.provider)) return { status: "ignored", reason: "unsupported_event" };
  if (!event.subjectReference) return { status: "ignored", reason: "missing_subject" };
  return adapter.apply(db, event.subjectReference, event.data, { provider: event.provider, observedAt: event.createdAt });
}
