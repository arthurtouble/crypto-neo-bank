import { env } from "cloudflare:workers";
import { z } from "zod";
import { isAddress } from "viem";
import { normalizeAuraTag, type AuraTagRow } from "@/lib/aura-tags";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { shortAddress } from "@/lib/format";
import { announce } from "@/lib/notifications/deliver";
import { securityNotice } from "@/lib/notifications/store";
import { confirmWithPasskey } from "@/lib/security/confirm";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { errorResponse, route, readJsonBody } from "@/lib/http/route";

const inputSchema = z.object({ tag: z.string(), address: z.string(), displayName: z.string().trim().min(1).max(48).refine((value) => !/\p{C}/u.test(value)), publicEnabled: z.boolean(), publicBankEnabled: z.boolean().default(false),
  /** The passkey confirmation that changing the receiving address needs (`lib/security/step-up.ts`). */
  confirmation: z.strictObject({ challengeId: z.string().uuid(), signature: z.string().regex(/^[A-Za-z0-9+/]+={0,2}$/).min(40).max(400) }).optional() }).strict();

export const GET = route("aura_tags.get", { unavailable: "tag_unavailable" }, async (request: Request) => {
  const subject = await requireVerifiedSubject(request);
  const row = await env.PROJECTION_DB.prepare("SELECT tag, receiving_address, display_name, public_enabled, public_bank_enabled FROM aura_tags WHERE subject_reference = ? AND active = 1")
    .bind(subject.subjectReference).first<{ tag: string; receiving_address: string; display_name: string; public_enabled: number; public_bank_enabled: number }>();
  return Response.json({ tag: row ? { tag: row.tag, address: row.receiving_address, displayName: row.display_name, publicEnabled: row.public_enabled === 1, publicBankEnabled: row.public_bank_enabled === 1 } : null }, { headers: { "Cache-Control": "no-store" } });
});

export const PUT = route("aura_tags.put", { unavailable: "tag_unavailable", invalid: "invalid_tag", onError: (error, context) => !(error instanceof Error) ? undefined : error.message.startsWith("Choose a tag") ? errorResponse(400, "invalid_tag", context) : /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(error.message) ? errorResponse(409, "tag_taken", context) : undefined }, async (request: Request, context) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "aura_tag_change", subject: subject.subjectReference, limit: 6, windowSeconds: 3600 });
  const input = inputSchema.parse(await readJsonBody(request));
  const tag = normalizeAuraTag(input.tag);
  if (!isAddress(input.address)) return Response.json({ error: "invalid_address" }, { status: 400 });
  const address = await requireLinkedEvmWallet(subject.subjectReference, input.address);
  const now = new Date().toISOString();
  const current = await env.PROJECTION_DB.prepare("SELECT tag, receiving_address FROM aura_tags WHERE subject_reference = ? AND active = 1")
    .bind(subject.subjectReference).first<Pick<AuraTagRow, "tag" | "receiving_address">>();
  const target = await env.PROJECTION_DB.prepare("SELECT subject_reference FROM aura_tags WHERE tag = ?")
    .bind(tag).first<Pick<AuraTagRow, "subject_reference">>();
  if (target && target.subject_reference !== subject.subjectReference) return Response.json({ error: "tag_taken" }, { status: 409 });
  // Payments to the tag go wherever this address points, so changing it needs a fresh passkey confirmation of exactly
  // this change, like loosening a control. Choosing the first address, or keeping it, doesn't.
  const addressChanged = Boolean(current && current.receiving_address.toLowerCase() !== address);
  if (addressChanged) {
    const asked = await confirmWithPasskey(env.PROJECTION_DB, { subject: subject.subjectReference, purpose: "aura_tag_address",
      payload: { tag, address, from: current!.receiving_address.toLowerCase() }, summary: `send payments to @${tag} to ${shortAddress(address)}`,
      confirmation: input.confirmation, traceId: context.traceId });
    if (asked) return asked;
  }
  const audit = env.PROJECTION_DB.prepare(`INSERT INTO audit_events
    (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
    VALUES (?, ?, 'customer', ?, 'aura_tag_saved', 'aura_tag', ?, ?, ?)`)
    .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, tag, JSON.stringify({ previousTag: current?.tag ?? null, publicEnabled: input.publicEnabled,
      publicBankEnabled: input.publicEnabled && input.publicBankEnabled, receivingAddress: address, previousAddress: current?.receiving_address ?? null,
      confirmedWithPasskey: addressChanged }), now);
  if (current?.tag === tag) {
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE aura_tags SET receiving_address = ?, display_name = ?, public_enabled = ?, public_bank_enabled = ?, updated_at = ? WHERE tag = ? AND subject_reference = ? AND active = 1")
        .bind(address, input.displayName, input.publicEnabled ? 1 : 0, input.publicEnabled && input.publicBankEnabled ? 1 : 0, now, tag, subject.subjectReference),
      audit
    ]);
  } else {
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("UPDATE aura_tags SET active = 0, public_enabled = 0, public_bank_enabled = 0, updated_at = ? WHERE subject_reference = ? AND active = 1").bind(now, subject.subjectReference),
      target
        ? env.PROJECTION_DB.prepare("UPDATE aura_tags SET receiving_address = ?, display_name = ?, public_enabled = ?, public_bank_enabled = ?, active = 1, updated_at = ? WHERE tag = ? AND subject_reference = ?")
          .bind(address, input.displayName, input.publicEnabled ? 1 : 0, input.publicEnabled && input.publicBankEnabled ? 1 : 0, now, tag, subject.subjectReference)
        : env.PROJECTION_DB.prepare("INSERT INTO aura_tags (tag, subject_reference, receiving_address, display_name, public_enabled, public_bank_enabled, active, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)")
          .bind(tag, subject.subjectReference, address, input.displayName, input.publicEnabled ? 1 : 0, input.publicEnabled && input.publicBankEnabled ? 1 : 0, now, now),
      audit
    ]);
  }
  // Where the tag's payments go is a security setting: the customer always hears about a change.
  if (addressChanged) await announce(env.PROJECTION_DB, subject.subjectReference, securityNotice("tag_address_changed",
    `Payments to @${tag} now go to ${shortAddress(address)}, confirmed with your passkey.`, `${tag}:${address}:${now}`));
  return Response.json({ tag, address, displayName: input.displayName, publicEnabled: input.publicEnabled, publicBankEnabled: input.publicEnabled && input.publicBankEnabled }, { headers: { "Cache-Control": "no-store" } });
});
