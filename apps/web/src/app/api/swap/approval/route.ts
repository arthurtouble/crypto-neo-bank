import { env } from "cloudflare:workers";
import { createPublicClient, http, isAddress } from "viem";
import { z } from "zod";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { BetaAccessError, configuredCountries, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature } from "@/lib/features/flags";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { observeTransaction, observeTransactionIdentity } from "@/lib/transactions/chain-observation";
import { matchesPreparedCall, normalizePreparedCall } from "@/lib/transactions/evidence";
import { observeNextSwapApproval } from "@/lib/swap/approval-steps";
import { verifySwapApprovalEffect } from "@/lib/swap/approval-effect";
import { resolveCatalogAsset } from "@/lib/swap/catalog";
import { isDirectUniswapPlan } from "@/lib/swap/direct-uniswap";
import { getActiveSwapQuotePlan } from "@/lib/swap/plans";
import { assertSwapPrepareIntegrity } from "@/lib/swap/prepare-integrity";

const prepareSchema = z.object({ intentId: z.string().uuid(), planId: z.string().uuid(),
  walletAddress: z.string().refine(isAddress) }).strict();
const reportSchema = z.object({ approvalId: z.string().uuid(),
  transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) }).strict();
type Intent = { intent_id: string; intent_type: string; wallet_reference: string; status: string;
  expires_at: string; route_reference: string | null; policy_result_json: string };
type Approval = { approval_id: string; subject_reference: string; wallet_address: string; token_address: string;
  spender_address: string; amount_raw: string; call_json: string; call_fingerprint: string;
  status: string; transaction_hash: string | null; expires_at: string };

function reply(body: Record<string, unknown>, status = 200) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

/** Prepare one exact approval, independently of the swap intent. It is not swap signing authority. */
export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const beta = await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    const countries = configuredCountries();
    if (beta.mode !== "invite" || beta.status !== "active" || !beta.countryCode
      || !countries.includes(beta.countryCode)) return reply({ error: "access_unavailable", traceId }, 403);
    await requireFeature(env.PROJECTION_DB, "swaps");
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "swap_approval_prepare", subject: subject.subjectReference,
      limit: 12, windowSeconds: 600 });
    const input = prepareSchema.parse(await request.json());
    const wallet = await requireLinkedEvmWallet(subject.subjectReference, input.walletAddress);
    const now = new Date();
    const [plan, intent, prior] = await Promise.all([
      getActiveSwapQuotePlan(env.PROJECTION_DB, input.planId, subject.subjectReference, wallet, now.getTime()),
      env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, wallet_reference, status, expires_at,
        route_reference, policy_result_json
        FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?`)
        .bind(input.intentId, subject.subjectReference).first<Intent>(),
      env.PROJECTION_DB.prepare("SELECT approval_id FROM swap_approval_requests WHERE plan_id = ?")
        .bind(input.planId).first<{ approval_id: string }>()
    ]);
    if (prior) return reply({ error: "approval_already_prepared", traceId }, 409);
    if (!plan || !isDirectUniswapPlan(plan) || plan.intent_id !== input.intentId
      || !intent || intent.intent_type !== "swap" || intent.status !== "reviewed"
      || intent.wallet_reference !== `wallet:${wallet}` || intent.expires_at <= now.toISOString()
      || intent.route_reference !== `swap-plan:${plan.plan_id}`
      || z.object({ permitted: z.literal(true) }).passthrough().safeParse(JSON.parse(intent.policy_result_json)).success === false)
      return reply({ error: "review_mismatch", traceId }, 409);
    const [from, to] = await Promise.all([resolveCatalogAsset(plan.source_asset_id), resolveCatalogAsset(plan.destination_asset_id)]);
    if (!from || !to) return reply({ error: "route_unavailable", traceId }, 422);
    let governed;
    try { governed = await assertSwapPrepareIntegrity(plan, { from, to }, now.getTime()); }
    catch { return reply({ error: "route_unavailable", traceId }, 422); }
    const chain = SUPPORTED_CHAINS.find(({ id }) => id === 8453);
    if (!chain) return reply({ error: "route_unavailable", traceId }, 422);
    const client = createPublicClient({ transport: http(chain.rpcUrls.default.http[0]) });
    const observed = await observeNextSwapApproval(client, { plan: {
      fromAssetId: plan.source_asset_id, fromChainId: 8453, fromAmountRaw: plan.from_amount_raw,
      approvalSpender: plan.approval_spender, sourceCall: governed.sourceCall
    }, wallet, reviewedSpender: governed.reviewedSpender, nowMs: now.getTime(), maxAgeMs: 120_000 });
    if (observed.kind === "sufficient") return reply({ error: "approval_already_sufficient", traceId }, 409);
    const call = await normalizePreparedCall(observed.step);
    const at = new Date().toISOString();
    if (plan.expires_at <= at || intent.expires_at <= at) return reply({ error: "quote_expired", traceId }, 409);
    const approvalId = crypto.randomUUID();
    // This is approval for this reviewed trade, not standing router consent.
    const expiresAt = new Date(Math.min(Date.parse(plan.expires_at), Date.parse(intent.expires_at))).toISOString();
    const inserted = await env.PROJECTION_DB.prepare(`INSERT INTO swap_approval_requests
      (approval_id, subject_reference, wallet_address, intent_id, plan_id, token_address,
       spender_address, amount_raw, call_json, call_fingerprint, status, expires_at, created_at, updated_at)
      SELECT ?, i.subject_reference, p.wallet_address, i.intent_id, p.plan_id, ?, ?, ?, ?, ?, 'prepared', ?, ?, ?
      FROM swap_quote_plans p JOIN transaction_intents i ON i.intent_id = p.intent_id
      JOIN security_profiles s ON s.subject_reference = i.subject_reference AND s.account_locked = 0
      JOIN beta_access b ON b.subject_reference = i.subject_reference AND b.status = 'active' AND b.country_code = ?
      JOIN feature_flags f ON f.flag_key = 'swaps' AND f.enabled = 1 AND f.audience IN ('all', 'beta')
      WHERE p.plan_id = ? AND i.intent_id = ? AND p.subject_reference = ? AND p.wallet_address = ?
        AND p.tool_id = 'uniswap_v3_direct' AND p.status = 'active' AND i.status = 'reviewed'
        AND i.route_reference = 'swap-plan:' || p.plan_id
        AND json_extract(i.policy_result_json, '$.permitted') = 1
        AND p.expires_at > ? AND p.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND i.expires_at > ? AND i.expires_at > strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        AND p.approval_spender = ? AND (p.from_amount_raw = ? OR ? = '0')
        AND NOT EXISTS (SELECT 1 FROM swap_approval_requests prior WHERE prior.plan_id = p.plan_id)`)
      .bind(approvalId, call.to.toLowerCase(), observed.step.spender.toLowerCase(), observed.step.amountRaw,
        JSON.stringify({ chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data }),
        call.fingerprint, expiresAt, at, at, beta.countryCode, plan.plan_id, intent.intent_id,
        subject.subjectReference, wallet, at, at, observed.step.spender.toLowerCase(),
        observed.step.amountRaw, observed.step.amountRaw).run();
    if (inserted.meta.changes !== 1) return reply({ error: "approval_conflict", traceId }, 409);
    return reply({ approvalId, kind: observed.kind, amountRaw: observed.step.amountRaw,
      spender: observed.step.spender, fingerprint: call.fingerprint,
      call: { chainId: call.chainId, from: call.from, to: call.to, value: call.value, data: call.data },
      expiresAt, traceId }, 201);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof BetaAccessError) return reply({ error: error.code, traceId }, 403);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", traceId }, 403);
    if (error instanceof FeatureUnavailableError) return reply({ error: "feature_unavailable", traceId }, 503);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", traceId }, 429);
    if (error instanceof z.ZodError) return reply({ error: "invalid_approval", traceId }, 400);
    console.error(JSON.stringify({ level: "error", event: "swap.approval_prepare_failed", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "approval_unavailable", traceId }, 503);
  }
}

async function ownedApproval(request: Request, approvalId: string): Promise<Approval | null> {
  const subject = await requireVerifiedSubject(request);
  return env.PROJECTION_DB.prepare("SELECT * FROM swap_approval_requests WHERE approval_id = ? AND subject_reference = ?")
    .bind(approvalId, subject.subjectReference).first<Approval>();
}

/** A late hash is observation only; it cannot renew the approval or swap review. */
export async function PATCH(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const input = reportSchema.parse(await request.json());
    const approval = await ownedApproval(request, input.approvalId);
    if (!approval) return reply({ error: "approval_not_found", traceId }, 404);
    const hash = input.transactionHash.toLowerCase();
    if (approval.transaction_hash && approval.transaction_hash.toLowerCase() !== hash)
      return reply({ error: "hash_conflict", traceId }, 409);
    if (approval.status === "confirmed" || approval.status === "failed" || approval.status === "inconsistent")
      return reply({ status: approval.status, traceId });
    const call = await normalizePreparedCall(JSON.parse(approval.call_json));
    if (call.fingerprint !== approval.call_fingerprint) return reply({ error: "approval_integrity", traceId }, 409);
    const observed = await observeTransactionIdentity(8453, hash);
    if (observed.status === "found" && !(await matchesPreparedCall(call, observed.call)).matches)
      return reply({ error: "transaction_mismatch", traceId }, 409);
    const now = new Date().toISOString();
    const status = observed.status === "found" ? "submitted" : "prepared";
    const saved = await env.PROJECTION_DB.prepare(`UPDATE swap_approval_requests
      SET transaction_hash = ?, status = ?, updated_at = ?
      WHERE approval_id = ? AND subject_reference = ? AND status IN ('prepared', 'submitted')
        AND (transaction_hash IS NULL OR transaction_hash = ?)`) // No signing gate here: observe a broadcast hash even after expiry.
      .bind(hash, status, now, approval.approval_id, approval.subject_reference, hash).run();
    if (saved.meta.changes !== 1) return reply({ error: "approval_conflict", traceId }, 409);
    return reply({ status: observed.status === "found" ? "submitted" : "pending", traceId }, observed.status === "found" ? 200 : 202);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof z.ZodError) return reply({ error: "invalid_report", traceId }, 400);
    console.error(JSON.stringify({ level: "error", event: "swap.approval_report_failed", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "report_unavailable", traceId }, 503);
  }
}

export async function GET(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const approvalId = new URL(request.url).searchParams.get("approvalId");
    if (!approvalId || !z.string().uuid().safeParse(approvalId).success)
      return reply({ error: "invalid_approval", traceId }, 400);
    const approval = await ownedApproval(request, approvalId);
    if (!approval) return reply({ error: "approval_not_found", traceId }, 404);
    if (!approval.transaction_hash) return reply({ status: "prepared", expiresAt: approval.expires_at, traceId });
    if (["confirmed", "failed", "inconsistent"].includes(approval.status))
      return reply({ status: approval.status, transactionHash: approval.transaction_hash, traceId });
    const call = await normalizePreparedCall(JSON.parse(approval.call_json));
    if (call.fingerprint !== approval.call_fingerprint) return reply({ error: "approval_integrity", traceId }, 409);
    const observed = await observeTransaction(8453, approval.transaction_hash);
    const result = await verifySwapApprovalEffect({ call, observed, expected: {
      wallet: approval.wallet_address, token: approval.token_address, spender: approval.spender_address,
      amountRaw: approval.amount_raw, reportedHash: approval.transaction_hash } });
    if (["confirmed", "failed", "inconsistent"].includes(result.status)) {
      await env.PROJECTION_DB.prepare(`UPDATE swap_approval_requests SET status = ?, updated_at = ?
        WHERE approval_id = ? AND subject_reference = ? AND transaction_hash = ?
          AND status IN ('prepared', 'submitted')`)
        .bind(result.status, new Date().toISOString(), approval.approval_id,
          approval.subject_reference, approval.transaction_hash).run();
    }
    return reply({ status: result.status, reason: result.reason,
      transactionHash: approval.transaction_hash, traceId });
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    console.error(JSON.stringify({ level: "error", event: "swap.approval_status_failed", traceId,
      message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "status_unavailable", traceId }, 503);
  }
}
