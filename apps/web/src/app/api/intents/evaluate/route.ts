import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { ensureSubjectProfile } from "@/lib/profile/ensure";

async function fingerprint(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

const intentSchema = z.object({
  type: z.enum(["transfer", "swap", "bridge", "earn_supply", "earn_withdraw", "borrow", "repay"]),
  walletAddress: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.number().int().positive(),
  asset: z.string().min(1).max(20),
  amount: z.string().regex(/^\d+(\.\d+)?$/),
  destination: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  estimatedUsd: z.number().nonnegative().optional(),
  availableUsd: z.number().nonnegative().optional(),
  disclosureVersion: z.string().min(1).max(80).default("transaction-risk-2026-09")
});

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "intent", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const input = intentSchema.parse(await request.json());
    const now = new Date();
    await ensureSubjectProfile(env.PROJECTION_DB, subject.subjectReference, now);
    const requestFingerprint = await fingerprint(input);
    const matured = await env.PROJECTION_DB.prepare(`SELECT intent_id FROM transaction_intents
      WHERE subject_reference = ? AND request_fingerprint = ? AND status = 'cooling' AND release_at <= ?
      ORDER BY created_at DESC LIMIT 1`).bind(subject.subjectReference, requestFingerprint, now.toISOString()).first<{ intent_id: string }>();
    const [securityProfile, addressRows, spentRow] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("SELECT account_locked, enforce_address_book, daily_limit_usd, new_address_threshold_usd, step_up_threshold_usd, new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference),
      env.PROJECTION_DB.prepare("SELECT address, available_at FROM address_book_entries WHERE subject_reference = ? AND chain_family = 'evm'").bind(subject.subjectReference),
      env.PROJECTION_DB.prepare(`SELECT COALESCE(SUM(CAST(json_extract(request_json, '$.estimatedUsd') AS REAL)), 0) AS spent
        FROM transaction_intents WHERE subject_reference = ? AND status IN ('submitted', 'confirmed') AND created_at >= ?`)
        .bind(subject.subjectReference, new Date(now.getTime() - 86_400_000).toISOString())
    ]);
    const profile = securityProfile.results[0] as unknown as { account_locked: number; enforce_address_book: number; daily_limit_usd: number; new_address_threshold_usd: number; step_up_threshold_usd: number; new_address_delay_seconds: number } | undefined;
    const saved = addressRows.results as unknown as Array<{ address: string; available_at: string }>;
    const spentTodayUsd = Number((spentRow.results[0] as unknown as { spent: number } | undefined)?.spent ?? 0);
    const decision = evaluateTransactionPolicy(input, {
      supportedChainIds: [8453, 1, 42161, 10, 137],
      allowlistedDestinations: saved.filter((item) => new Date(item.available_at) <= now).map((item) => item.address),
      coolingDestinations: saved.filter((item) => new Date(item.available_at) > now).map((item) => item.address),
      enforceAllowlist: Boolean(profile?.enforce_address_book),
      accountLocked: Boolean(profile?.account_locked),
      reserveFloorUsd: 10_000,
      dailyLimitUsd: profile?.daily_limit_usd ?? 25_000,
      spentTodayUsd,
      newAddressThresholdUsd: profile?.new_address_threshold_usd ?? 1_000,
      stepUpThresholdUsd: profile?.step_up_threshold_usd ?? 10_000,
      delayThresholdUsd: matured ? Number.MAX_SAFE_INTEGER : 25_000,
      delaySeconds: profile?.new_address_delay_seconds ?? 86_400
    }, now);
    const intentId = crypto.randomUUID();
    const walletReference = `wallet:${input.walletAddress.toLowerCase()}`;

    if (matured && decision.permitted) {
      const expiresAt = new Date(now.getTime() + 15 * 60_000).toISOString();
      await env.PROJECTION_DB.batch([
        env.PROJECTION_DB.prepare("UPDATE transaction_intents SET status = 'reviewed', updated_at = ?, expires_at = ? WHERE intent_id = ? AND subject_reference = ? AND status = 'cooling'").bind(now.toISOString(), expiresAt, matured.intent_id, subject.subjectReference),
        env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at) VALUES (?, ?, ?, 'cooling_completed', '{}', ?)`)
          .bind(crypto.randomUUID(), matured.intent_id, subject.subjectReference, now.toISOString())
      ]);
      return Response.json({ intentId: matured.intent_id, decision, traceId }, { status: 200, headers: { "Cache-Control": "no-store" } });
    }

    const cooling = decision.permitted && Boolean(decision.releaseAt);
    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO wallet_references
        (wallet_reference, subject_reference, provider, provider_wallet_reference, address, chain_family, control_model, observed_at)
        VALUES (?, ?, 'privy', NULL, ?, 'evm', 'user-controlled', ?)
        ON CONFLICT(subject_reference, address) DO UPDATE SET observed_at = excluded.observed_at`)
        .bind(walletReference, subject.subjectReference, input.walletAddress.toLowerCase(), now.toISOString()),
      env.PROJECTION_DB.prepare(`INSERT INTO transaction_intents
        (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json, policy_result_json, disclosure_version, status, created_at, updated_at, expires_at, release_at, request_fingerprint)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(intentId, subject.subjectReference, walletReference, input.type, input.chainId, JSON.stringify(input), JSON.stringify(decision), input.disclosureVersion, cooling ? "cooling" : decision.permitted ? "reviewed" : "blocked", now.toISOString(), now.toISOString(), cooling && decision.releaseAt ? new Date(new Date(decision.releaseAt).getTime() + 15 * 60_000).toISOString() : new Date(now.getTime() + 15 * 60_000).toISOString(), decision.releaseAt ?? null, requestFingerprint),
      env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
        VALUES (?, ?, ?, 'policy_evaluated', ?, ?)`)
        .bind(crypto.randomUUID(), intentId, subject.subjectReference, JSON.stringify({ permitted: decision.permitted, cooling, findings: decision.findings.map((item) => item.code) }), now.toISOString())
    ]);

    return Response.json({ intentId, decision, message: cooling ? `This action is in its security review period until ${decision.releaseAt}. Prepare it again after that time.` : undefined, traceId }, { status: cooling ? 423 : decision.permitted ? 201 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof RateLimitError) return Response.json({ error: "rate_limited", message: error.message, traceId }, { status: 429, headers: { "Retry-After": String(error.retryAfterSeconds) } });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_intent", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "intent.evaluate.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "intent_unavailable", message: "The transaction could not be reviewed.", traceId }, { status: 503 });
  }
}
