import { z } from "zod";

export type LifecycleMessage = { recipientReference: string; purpose: "beta_operational" | "marketing"; templateKey: string; templateVersion: string; variables: Record<string, string>; idempotencyKey: string };
export interface LifecycleMessenger { send(message: LifecycleMessage): Promise<{ providerReference: string; status: "accepted" | "rejected" }> }

export const lifecycleTemplates = {
  private_beta_invitation: { version: "v1", purpose: "beta_operational", claimIds: [] },
  invitation_expires_soon: { version: "v1", purpose: "beta_operational", claimIds: [] },
  onboarding_incomplete: { version: "v1", purpose: "beta_operational", claimIds: [] },
  first_value_help: { version: "v1", purpose: "beta_operational", claimIds: [] },
  feedback_request: { version: "v1", purpose: "beta_operational", claimIds: [] },
  monthly_trust_update: { version: "v1", purpose: "marketing", claimIds: ["no-house-token-v1"] }
} as const;

export const lifecycleMessageSchema = z.object({ recipientReference: z.string().min(3).max(128), purpose: z.enum(["beta_operational","marketing"]), templateKey: z.enum(Object.keys(lifecycleTemplates) as [keyof typeof lifecycleTemplates, ...(keyof typeof lifecycleTemplates)[]]), templateVersion: z.string().max(20), variables: z.record(z.string().regex(/^[a-z][a-zA-Z0-9]{0,40}$/), z.string().max(200)).default({}), idempotencyKey: z.string().min(8).max(128) }).strict();

export class LocalLifecycleMessenger implements LifecycleMessenger {
  async send(message: LifecycleMessage) { return { providerReference: `local:${message.idempotencyKey}`, status: "accepted" as const }; }
}

export async function hasConsent(database: D1Database, recipientReference: string, purpose: LifecycleMessage["purpose"]) {
  const latest = await database.prepare("SELECT action FROM growth_consent_events WHERE subject_reference = ? AND purpose = ? ORDER BY occurred_at DESC, (action = 'withdrawn') DESC LIMIT 1")
    .bind(recipientReference, purpose).first<{ action: string }>();
  return latest?.action === "granted";
}

export async function sendLifecycleMessage(database: D1Database, messenger: LifecycleMessenger, raw: LifecycleMessage, actorReference: string) {
  const message = lifecycleMessageSchema.parse(raw); const template = lifecycleTemplates[message.templateKey];
  if (template.version !== message.templateVersion || template.purpose !== message.purpose) throw new Error("Template purpose or version mismatch.");
  const existing = await database.prepare("SELECT provider_reference, status FROM growth_communications WHERE idempotency_key = ?").bind(message.idempotencyKey).first<{ provider_reference: string | null; status: string }>();
  if (existing) return { providerReference: existing.provider_reference ?? "", status: existing.status };
  if (!await hasConsent(database, message.recipientReference, message.purpose)) throw new Error("No active consent exists for this purpose.");
  if (message.purpose === "marketing") {
    const restricted = await database.prepare("SELECT status FROM beta_access WHERE subject_reference = ? AND status != 'active'").bind(message.recipientReference).first();
    if (restricted) throw new Error("Account messages take precedence over marketing.");
    const recent = await database.prepare("SELECT COUNT(*) AS count FROM growth_communications WHERE purpose = 'marketing' AND subject_reference = ? AND created_at >= datetime('now', '-30 days') AND status != 'failed'").bind(message.recipientReference).first<{ count: number }>();
    if (Number(recent?.count ?? 0) >= 2) throw new Error("Marketing frequency cap reached.");
  }
  const result = await messenger.send(message); const now = new Date().toISOString();
  await database.batch([
    database.prepare(`INSERT INTO growth_communications (communication_id, subject_reference, purpose, template_key, template_version, idempotency_key, provider_reference, status, sent_at, delivered_at, failed_at, failure_code, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?)`).bind(crypto.randomUUID(), message.recipientReference, message.purpose, message.templateKey, message.templateVersion, message.idempotencyKey, result.providerReference, result.status, result.status === "accepted" ? now : null, now),
    database.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at) VALUES (?, ?, 'operator', ?, 'growth_communication_created', 'growth_communication', ?, ?, ?)`).bind(crypto.randomUUID(), message.recipientReference, actorReference, message.idempotencyKey, JSON.stringify({ purpose: message.purpose, templateKey: message.templateKey, templateVersion: message.templateVersion, status: result.status }), now)
  ]);
  return result;
}
