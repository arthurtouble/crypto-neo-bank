import { env } from "cloudflare:workers";
import { z } from "zod";
import { isAddress } from "viem";
import { normalizeAuraTag, type AuraTagRow } from "@/lib/aura-tags";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { requireLinkedEvmWallet, WalletOwnershipError } from "@/lib/auth/wallet";
import { requireBetaAccess, BetaAccessError } from "@/lib/beta/access";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";

const inputSchema = z.object({ tag: z.string(), address: z.string(), displayName: z.string().trim().min(1).max(48).refine((value) => !/\p{C}/u.test(value)), publicEnabled: z.boolean(), publicBankEnabled: z.boolean().default(false) }).strict();

export async function GET(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    const row = await env.PROJECTION_DB.prepare("SELECT tag, receiving_address, display_name, public_enabled, public_bank_enabled FROM aura_tags WHERE subject_reference = ? AND active = 1")
      .bind(subject.subjectReference).first<{ tag: string; receiving_address: string; display_name: string; public_enabled: number; public_bank_enabled: number }>();
    return Response.json({ tag: row ? { tag: row.tag, address: row.receiving_address, displayName: row.display_name, publicEnabled: row.public_enabled === 1, publicBankEnabled: row.public_bank_enabled === 1 } : null }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code }, { status: 403 });
    return Response.json({ error: "tag_unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request) {
  try {
    const subject = await requireVerifiedSubject(request);
    await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "aura_tag_change", subject: subject.subjectReference, limit: 6, windowSeconds: 3600 });
    const input = inputSchema.parse(await request.json());
    const tag = normalizeAuraTag(input.tag);
    if (!isAddress(input.address)) return Response.json({ error: "invalid_address" }, { status: 400 });
    const address = await requireLinkedEvmWallet(subject.subjectReference, input.address);
    const now = new Date().toISOString();
    const current = await env.PROJECTION_DB.prepare("SELECT tag FROM aura_tags WHERE subject_reference = ? AND active = 1")
      .bind(subject.subjectReference).first<Pick<AuraTagRow, "tag">>();
    const target = await env.PROJECTION_DB.prepare("SELECT subject_reference FROM aura_tags WHERE tag = ?")
      .bind(tag).first<Pick<AuraTagRow, "subject_reference">>();
    if (target && target.subject_reference !== subject.subjectReference) return Response.json({ error: "tag_taken" }, { status: 409 });
    const audit = env.PROJECTION_DB.prepare(`INSERT INTO audit_events
      (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES (?, ?, 'customer', ?, 'aura_tag_saved', 'aura_tag', ?, ?, ?)`)
      .bind(crypto.randomUUID(), subject.subjectReference, subject.subjectReference, tag, JSON.stringify({ previousTag: current?.tag ?? null, publicEnabled: input.publicEnabled, publicBankEnabled: input.publicEnabled && input.publicBankEnabled, receivingAddress: address }), now);
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
    return Response.json({ tag, address, displayName: input.displayName, publicEnabled: input.publicEnabled, publicBankEnabled: input.publicEnabled && input.publicBankEnabled }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized" }, { status: 401 });
    if (error instanceof BetaAccessError) return Response.json({ error: error.code }, { status: 403 });
    if (error instanceof WalletOwnershipError) return Response.json({ error: "wallet_not_linked" }, { status: 403 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited" }, { status: 429 });
    if (error instanceof z.ZodError || error instanceof Error && error.message.startsWith("Choose a tag")) return Response.json({ error: "invalid_tag" }, { status: 400 });
    if (error instanceof Error && /UNIQUE constraint failed|PRIMARY KEY constraint failed/i.test(error.message)) return Response.json({ error: "tag_taken" }, { status: 409 });
    console.error("Aura tag save failed", error);
    return Response.json({ error: "tag_unavailable" }, { status: 503 });
  }
}
