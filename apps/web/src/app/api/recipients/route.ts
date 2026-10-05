import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { loadControls } from "@/lib/actions/controls";
import { shortAddress } from "@/lib/money/format";
import { ensureSubjectProfile } from "@/lib/profile/ensure";
import { enforceRateLimit } from "@/lib/security/rate-limit";
import { saveWalletAddress } from "@/lib/security/wallet-address-book";
import { route, readJsonBody } from "@/lib/http/route";

const createSchema = z.object({ kind: z.literal("wallet"), address: z.string().regex(/^0x[a-fA-F0-9]{40}$/), name: z.string().trim().min(1).max(48) });
type WalletRow = { entry_id: string; address: string; label: string; available_at: string; last_used_at: string | null };
type BankRow = { beneficiary_id: string; display_name: string; account_hint: string | null; rail: string | null; verification_status: string; available_at: string | null; last_used_at: string | null };
type RecentRow = { address: string; used_at: string; asset_id: string | null; chain_id: number };

export const GET = route("recipients.get", { unavailable: "recipients_unavailable" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const [wallets, banks, recent] = await env.PROJECTION_DB.batch([
    env.PROJECTION_DB.prepare("SELECT entry_id, address, label, available_at, last_used_at FROM address_book_entries WHERE subject_reference = ? ORDER BY COALESCE(last_used_at, created_at) DESC").bind(subject.subjectReference),
    env.PROJECTION_DB.prepare("SELECT beneficiary_id, display_name, account_hint, rail, verification_status, available_at, last_used_at FROM bank_beneficiary_projections WHERE subject_reference = ? AND verification_status != 'removed' ORDER BY COALESCE(last_used_at, observed_at) DESC").bind(subject.subjectReference),
    // Who this account sent to, newest first, with the asset and network of the latest send to each: transfers on the
    // account's network, and routes that paid someone on another network (a route's $.to is the asset it delivers).
    env.PROJECTION_DB.prepare(`SELECT address, created_at AS used_at, asset_id, chain_id FROM (
        SELECT address, asset_id, chain_id, created_at, ROW_NUMBER() OVER (PARTITION BY address ORDER BY created_at DESC) AS n FROM (
          SELECT CASE kind WHEN 'transfer' THEN json_extract(summary_json, '$.to') ELSE json_extract(summary_json, '$.recipient') END AS address,
            CASE kind WHEN 'transfer' THEN json_extract(summary_json, '$.assetId') ELSE json_extract(summary_json, '$.from.id') END AS asset_id,
            COALESCE(destination_chain_id, chain_id) AS chain_id, wallet_address, created_at
          FROM actions WHERE subject_reference = ? AND kind IN ('transfer', 'route') AND status IN ('submitted', 'settling', 'confirmed'))
        WHERE address IS NOT NULL AND address != wallet_address)
      WHERE n = 1 ORDER BY used_at DESC LIMIT 20`).bind(subject.subjectReference)
  ]);
  const now = Date.now();
  // A saved bank account waits like a new recipient, but only while saved-recipients-only is on (the payout route's rule).
  const { enforceAddressBook } = await loadControls(env.PROJECTION_DB, subject.subjectReference, null, new Date(now));
  const bankReady = (row: BankRow) => row.verification_status === "verified" && (!enforceAddressBook || (row.available_at !== null && new Date(row.available_at).getTime() <= now));
  const sent = (recent.results as unknown as RecentRow[]).filter((row) => /^0x[a-f0-9]{40}$/.test(row.address));
  const lastSent = new Map(sent.map((row) => [row.address, { lastUsedAt: row.used_at, lastAssetId: row.asset_id, lastChainId: row.chain_id }]));
  const neverSent = { lastUsedAt: null, lastAssetId: null, lastChainId: null };
  const savedAddresses = new Set((wallets.results as unknown as WalletRow[]).map((row) => row.address.toLowerCase()));
  // Wallet recipients, saved or not, the one paid most recently first; saved ones never paid follow, newest saved first.
  const walletRecipients = [
    ...(wallets.results as unknown as WalletRow[]).map((row) => ({ id: row.entry_id, kind: "wallet" as const, name: row.label, destination: row.address, detail: shortAddress(row.address), verified: new Date(row.available_at).getTime() <= now, availableAt: row.available_at, ...(lastSent.get(row.address.toLowerCase()) ?? neverSent) })),
    ...sent.filter((row) => !savedAddresses.has(row.address)).map((row) => ({ id: `recent:${row.address}`, kind: "wallet" as const, name: "Recent address", destination: row.address, detail: shortAddress(row.address), verified: false, recent: true, ...lastSent.get(row.address)! }))
  ].sort((a, b) => (b.lastUsedAt ?? "").localeCompare(a.lastUsedAt ?? ""));
  const recipients = [
    ...walletRecipients,
    ...(banks.results as unknown as BankRow[]).map((row) => ({ id: row.beneficiary_id, kind: "bank" as const, name: row.display_name, destination: row.beneficiary_id, detail: [row.rail?.toUpperCase(), row.account_hint].filter(Boolean).join(" · "), verified: bankReady(row), availableAt: row.available_at, lastUsedAt: row.last_used_at }))
  ];
  return Response.json({ recipients, observedAt: new Date().toISOString(), authority: "Security address book and provider beneficiary projections", traceId }, { headers: { "Cache-Control": "no-store" } });
});

export const POST = route("recipients.post", { unavailable: "recipient_create_unavailable", invalid: "invalid_recipient" }, async (request: Request, { traceId }) => {
  const subject = await requireVerifiedSubject(request);
  await enforceRateLimit(env.PROJECTION_DB, { namespace: "recipient_create", subject: subject.subjectReference, limit: 12, windowSeconds: 3600 });
  const input = createSchema.parse(await readJsonBody(request));
  await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference);
  const saved = await saveWalletAddress(env.PROJECTION_DB, subject.subjectReference, input.address, input.name);
  return Response.json({ recipient: { id: saved.entry_id, kind: "wallet", name: saved.label, destination: saved.address, verified: new Date(saved.available_at).getTime() <= Date.now(), availableAt: saved.available_at }, traceId }, { status: 201, headers: { "Cache-Control": "no-store" } });
});
