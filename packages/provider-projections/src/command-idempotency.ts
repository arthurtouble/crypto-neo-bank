import type { ProjectionDatabase } from "./database";

export type CommandClaim =
  | { outcome: "claimed"; key: string }
  | { outcome: "in_progress" | "completed"; key: string; providerObjectId: string | null };

type Input = { subjectReference: string; idempotencyKey: string; commandType: string; provider: string; ttlSeconds?: number; now?: Date };

/**
 * Reserve a provider command so a retried request cannot send it twice.
 * Keys are scoped to the customer. A failed or expired claim can be retried.
 */
export async function claimProviderCommand(db: ProjectionDatabase, input: Input): Promise<CommandClaim> {
  const now = input.now ?? new Date();
  const key = `${input.subjectReference}:${input.commandType}:${input.idempotencyKey}`;
  const expiresAt = new Date(now.getTime() + (input.ttlSeconds ?? 86_400) * 1000).toISOString();
  const claimed = await db.prepare(`INSERT INTO command_idempotency
    (idempotency_key, subject_reference, command_type, provider, provider_object_id, status, created_at, expires_at)
    VALUES (?, ?, ?, ?, NULL, 'in_progress', ?, ?)
    ON CONFLICT(idempotency_key) DO UPDATE SET status = 'in_progress', provider_object_id = NULL,
      created_at = excluded.created_at, expires_at = excluded.expires_at
    WHERE command_idempotency.status = 'failed' OR command_idempotency.expires_at <= excluded.created_at`)
    .bind(key, input.subjectReference, input.commandType, input.provider, now.toISOString(), expiresAt).run();
  if (claimed.meta.changes) return { outcome: "claimed", key };
  const existing = await db.prepare("SELECT status, provider_object_id FROM command_idempotency WHERE idempotency_key = ?")
    .bind(key).first<{ status: "in_progress" | "completed"; provider_object_id: string | null }>();
  return { outcome: existing?.status === "completed" ? "completed" : "in_progress", key, providerObjectId: existing?.provider_object_id ?? null };
}

/** Record the provider's answer for a claimed command. */
export async function settleProviderCommand(db: ProjectionDatabase, key: string, result: { status: "completed" | "failed"; providerObjectId?: string }): Promise<void> {
  await db.prepare("UPDATE command_idempotency SET status = ?, provider_object_id = ? WHERE idempotency_key = ? AND status = 'in_progress'")
    .bind(result.status, result.providerObjectId ?? null, key).run();
}
