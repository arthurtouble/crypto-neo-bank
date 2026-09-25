import { z } from "zod";
import { subjectExists, type ProjectionDatabase } from "./database";
import type { ApplyResult, ProjectionSource } from "./source";

/**
 * A signer-enforced wallet policy reported by the wallet provider
 * (`wallet.policy.updated`). The provider enforces it at signing; Aura only
 * displays it and never treats this row as the authority.
 */
export const walletPolicyEventSchema = z.object({
  policyId: z.string().min(1).max(160),
  policyType: z.enum(["destination_allowlist", "spend_limit", "contract_allowlist", "signer_quorum"]),
  configuration: z.record(z.string(), z.unknown()),
  enabled: z.boolean()
}).strict();

export type WalletPolicy = z.infer<typeof walletPolicyEventSchema> & { updatedAt: string };

/** One row per policy type; an older provider observation never replaces a newer one. */
export async function applyWalletPolicy(db: ProjectionDatabase, subjectReference: string, data: unknown, source: ProjectionSource): Promise<ApplyResult> {
  const parsed = walletPolicyEventSchema.safeParse(data);
  if (!parsed.success) return { status: "ignored", reason: "invalid_payload", detail: parsed.error.issues[0]?.message };
  if (!await subjectExists(db, subjectReference)) return { status: "ignored", reason: "unknown_subject" };
  const policy = parsed.data;
  const configuration = JSON.stringify({ ...policy.configuration, provider: source.provider });
  const result = await db.prepare(`INSERT INTO wallet_policies (policy_id, subject_reference, policy_type, configuration_json, enabled, updated_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(subject_reference, policy_type) DO UPDATE SET policy_id = excluded.policy_id,
      configuration_json = excluded.configuration_json, enabled = excluded.enabled, updated_at = excluded.updated_at
    WHERE excluded.updated_at > wallet_policies.updated_at`)
    .bind(policy.policyId, subjectReference, policy.policyType, configuration, policy.enabled ? 1 : 0, source.observedAt).run();
  return { status: result.meta.changes ? "applied" : "stale", projection: "wallet_policies" };
}

export async function readWalletPolicies(db: ProjectionDatabase, subjectReference: string): Promise<WalletPolicy[]> {
  const rows = await db.prepare(`SELECT policy_id, policy_type, configuration_json, enabled, updated_at
    FROM wallet_policies WHERE subject_reference = ? ORDER BY policy_type`).bind(subjectReference)
    .all<{ policy_id: string; policy_type: WalletPolicy["policyType"]; configuration_json: string; enabled: number; updated_at: string }>();
  return rows.results.map((row) => {
    let configuration: Record<string, unknown> = {};
    try { configuration = JSON.parse(row.configuration_json) as Record<string, unknown>; } catch { /* keep an empty record */ }
    return { policyId: row.policy_id, policyType: row.policy_type, configuration, enabled: row.enabled === 1, updatedAt: row.updated_at };
  });
}
