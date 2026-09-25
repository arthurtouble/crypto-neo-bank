import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { AddressStepUpUnavailableError, saveWalletAddress } from "@/lib/security/wallet-address-book";
import { route, errorResponse } from "@/lib/http/route";

const createSchema = z.object({ kind: z.literal("wallet"), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), name: z.string().trim().min(1).max(48) });
type WalletRow = { entry_id: string; address: string; label: string; available_at: string; last_used_at: string | null };
type BankRow = { beneficiary_id: string; display_name: string; account_hint: string | null; rail: string | null; verification_status: string; last_used_at: string | null };
type RecentRow = { address: string; used_at: string };

export const GET = route("recipients.get", { unavailable: "recipients_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const [wallets, banks, recent] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT entry_id, address, label, available_at, last_used_at FROM address_book_entries WHERE subject_reference = ? ORDER BY COALESCE(last_used_at, created_at) DESC").bind(subject.subjectReference),
    env.PROJECTION_DB.prepare("SELECT beneficiary_id, display_name, account_hint, rail, verification_status, last_used_at FROM bank_beneficiary_projections WHERE subject_reference = ? AND verification_status != 'removed' ORDER BY COALESCE(last_used_at, observed_at) DESC").bind(subject.subjectReference),
    env.PROJECTION_DB.prepare(`SELECT lower(json_extract(request_json, '$.destination')) AS address, MAX(created_at) AS used_at
      FROM transaction_intents WHERE subject_reference = ? AND intent_type = 'transfer' AND json_extract(request_json, '$.destination') IS NOT NULL
      GROUP BY lower(json_extract(request_json, '$.destination')) ORDER BY used_at DESC LIMIT 8`).bind(subject.subjectReference)
  ]);
  const now = Date.now();
  const savedAddresses = new Set((wallets.results as unknown as WalletRow[]).map((row) => row.address.toLowerCase()));
  const recipients = [
    ...(wallets.results as unknown as WalletRow[]).map((row) => ({ id: row.entry_id, kind: "wallet" as const, name: row.label, destination: row.address, detail: `${row.address.slice(0, 6)}…${row.address.slice(-4)}`, verified: new Date(row.available_at).getTime() <= now, availableAt: row.available_at, lastUsedAt: row.last_used_at })),
    ...(banks.results as unknown as BankRow[]).map((row) => ({ id: row.beneficiary_id, kind: "bank" as const, name: row.display_name, destination: row.beneficiary_id, detail: [row.rail?.toUpperCase(), row.account_hint].filter(Boolean).join(" · "), verified: row.verification_status === "verified", lastUsedAt: row.last_used_at })),
    ...(recent.results as unknown as RecentRow[]).filter((row) => /^0x[a-f0-9]{40}$/.test(row.address) && !savedAddresses.has(row.address)).map((row) => ({ id: `recent:${row.address}`, kind: "wallet" as const, name: "Recent address", destination: row.address, detail: `${row.address.slice(0, 6)}…${row.address.slice(-4)}`, verified: false, recent: true, lastUsedAt: row.used_at }))
  ];
  return Response.json({ recipients, observedAt: new Date().toISOString(), authority: "Security address book and provider beneficiary projections", traceId }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route("recipients.post", { unavailable: "recipient_create_unavailable", invalid: "invalid_recipient", onError: (error, context) => error instanceof AddressStepUpUnavailableError ? errorResponse(409, "step_up_unavailable", context) : undefined }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "recipient_create", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
  const input = createSchema.parse(await request.json());
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const saved = await saveWalletAddress(env.PROJECTION_DB, subject.subjectReference, input.address, input.name);
  return Response.json({ recipient: { id: saved.entry_id, kind: "wallet", name: saved.label, destination: saved.address, verified: new Date(saved.available_at).getTime() <= Date.now(), availableAt: saved.available_at }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
