import { env } from "cloudflare:workers";
import { z } from "zod";
import { getAddress } from "viem";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { writeAuditEvent } from "@/lib/security/audit";

const createSchema = z.object({ address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), label: z.string().trim().min(1).max(48) });
type EntryRow = { entry_id: string; address: string; label: string; created_at: string; available_at: string; last_used_at: string | null };

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const rows = await env.PROJECTION_DB.prepare("SELECT entry_id, address, label, created_at, available_at, last_used_at FROM address_book_entries WHERE subject_reference = ? ORDER BY created_at DESC").bind(subject.subjectReference).all<EntryRow>();
    return Response.json({ entries: rows.results.map((row) => ({ entryId: row.entry_id, address: row.address, label: row.label, createdAt: row.created_at, availableAt: row.available_at, lastUsedAt: row.last_used_at })), traceId }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "security.addresses.read.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "address_book_unavailable", traceId }, { status: 503 });
  }
}

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const input = createSchema.parse(await request.json());
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
    const profile = await env.PROJECTION_DB.prepare("SELECT new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference).first<{ new_address_delay_seconds: number }>();
    const now = new Date();
    const availableAt = new Date(now.getTime() + (profile?.new_address_delay_seconds ?? 86400) * 1000).toISOString();
    const entryId = crypto.randomUUID();
    const address = getAddress(input.address).toLowerCase();
    await env.PROJECTION_DB.prepare(`INSERT INTO address_book_entries (entry_id, subject_reference, chain_family, address, label, created_at, available_at)
      VALUES (?, ?, 'evm', ?, ?, ?, ?)
      ON CONFLICT(subject_reference, chain_family, address) DO UPDATE SET label = excluded.label`)
      .bind(entryId, subject.subjectReference, address, input.label, now.toISOString(), availableAt).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "security.address.added", targetType: "wallet_address", targetReference: address, evidence: { label: input.label, availableAt } });
    return Response.json({ entry: { entryId, address, label: input.label, createdAt: now.toISOString(), availableAt }, traceId }, { status: 201 });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_address_entry", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "security.addresses.create.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "address_create_unavailable", traceId }, { status: 503 });
  }
}

export async function DELETE(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const entryId = new URL(request.url).searchParams.get("entryId");
    if (!entryId || !z.string().uuid().safeParse(entryId).success) return Response.json({ error: "invalid_entry_id", traceId }, { status: 400 });
    const row = await env.PROJECTION_DB.prepare("SELECT address FROM address_book_entries WHERE entry_id = ? AND subject_reference = ?").bind(entryId, subject.subjectReference).first<{ address: string }>();
    if (!row) return Response.json({ error: "entry_not_found", traceId }, { status: 404 });
    await env.PROJECTION_DB.prepare("DELETE FROM address_book_entries WHERE entry_id = ? AND subject_reference = ?").bind(entryId, subject.subjectReference).run();
    await writeAuditEvent(env.PROJECTION_DB, { subjectReference: subject.subjectReference, actorType: "customer", actorReference: subject.subjectReference, action: "security.address.removed", targetType: "wallet_address", targetReference: row.address });
    return Response.json({ deleted: true, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "security.addresses.delete.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "address_delete_unavailable", traceId }, { status: 503 });
  }
}
