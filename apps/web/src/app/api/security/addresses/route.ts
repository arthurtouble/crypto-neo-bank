import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { AddressStepUpUnavailableError, removeWalletAddress, saveWalletAddress } from "@/lib/security/wallet-address-book";

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
    const saved = await saveWalletAddress(env.PROJECTION_DB, subject.subjectReference, input.address, input.label);
    return Response.json({ entry: { entryId: saved.entry_id, address: saved.address, label: saved.label, createdAt: saved.created_at, availableAt: saved.available_at }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_address_entry", issues: error.issues, traceId }, { status: 400 });
    if (error instanceof AddressStepUpUnavailableError) return Response.json({ error: "step_up_unavailable", traceId }, { status: 409, headers: { "Cache-Control": "no-store" } });
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
    const removed = await removeWalletAddress(env.PROJECTION_DB, subject.subjectReference, entryId, row.address);
    if (!removed) return Response.json({ error: "entry_not_found", traceId }, { status: 404 });
    return Response.json({ deleted: true, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    console.error(JSON.stringify({ level: "error", event: "security.addresses.delete.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "address_delete_unavailable", traceId }, { status: 503 });
  }
}
