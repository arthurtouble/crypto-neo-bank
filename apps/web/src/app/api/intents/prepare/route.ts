import { env } from "cloudflare:workers";
import { z } from "zod";
import { encodeFunctionData, erc20Abi, getAddress, isAddress, parseUnits } from "viem";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { FeatureUnavailableError, requireFeature, type FeatureKey } from "@/lib/features/flags";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";
import { enforceRateLimit, RateLimitError } from "@/lib/security/rate-limit";
import { normalizePreparedCall, type PreparedCallInput } from "@/lib/transactions/evidence";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";
import { ValuationError, valueTransfer } from "@/lib/transactions/valuation";

const address = z.string().refine(isAddress, "A valid EVM address is required.");
const rawAmount = z.string().regex(/^[1-9]\d*$/, "A positive integer amount is required.");
const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("native_transfer"), recipient: address, amountRaw: rawAmount }).strict(),
  z.object({ type: z.literal("erc20_transfer"), token: address, recipient: address, amountRaw: rawAmount }).strict(),
  z.object({ type: z.literal("erc20_approval"), token: address, spender: address, amountRaw: rawAmount }).strict()
]);

const prepareSchema = z.object({
  intentId: z.string().uuid(),
  stepIndex: z.number().int().min(0).max(7),
  call: z.object({ chainId: z.number().int().positive(), from: address, to: address, value: z.string().regex(/^\d+$/), data: z.string().regex(/^0x(?:[a-fA-F0-9]{2})*$/) }).strict(),
  semanticAction: z.enum(["native_transfer", "erc20_transfer", "erc20_approval"]),
  sourceReference: z.string().trim().min(1).max(200),
  expectedEffect: effectSchema
}).strict();

type Effect = z.infer<typeof effectSchema>;
type SemanticInput = { intentType: string; semanticAction: string; call: PreparedCallInput; expectedEffect: unknown; reviewedDestination?: string; reviewedAsset?: string; reviewedAmount?: string };
class PreparedActionError extends Error {}

function sameAddress(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }

/** Reject semantic labels or expected effects that do not exactly describe the call. */
export function validatePreparedAction(input: SemanticInput): Effect {
  const effect = effectSchema.parse(input.expectedEffect);
  if (input.semanticAction !== effect.type) throw new PreparedActionError("The expected effect does not match the action.");
  const call = input.call;
  const value = BigInt(call.value);
  if (effect.type === "erc20_approval") throw new PreparedActionError("An approval requires a server-validated execution plan.");
  if (input.intentType !== "transfer" || call.chainId !== HOME_CHAIN.id || !input.reviewedDestination || !input.reviewedAsset || !(input.reviewedAsset in BASE_ASSETS) || !input.reviewedAmount || !/^\d+(?:\.\d+)?$/.test(input.reviewedAmount)) throw new PreparedActionError("Transfer is not bound to a supported reviewed asset.");
  const asset = BASE_ASSETS[input.reviewedAsset as keyof typeof BASE_ASSETS];
  if ((input.reviewedAmount.split(".")[1]?.length ?? 0) > asset.decimals) throw new PreparedActionError("Transfer amount precision changed since review.");
  const reviewedRaw = parseUnits(input.reviewedAmount, asset.decimals);
  if (reviewedRaw <= 0n) throw new PreparedActionError("Reviewed amount is invalid.");
  if (effect.type === "native_transfer") {
    if (input.reviewedAsset !== "ETH" || !sameAddress(call.to, effect.recipient) || call.data.toLowerCase() !== "0x" || value !== BigInt(effect.amountRaw) || value !== reviewedRaw) throw new PreparedActionError("Native transfer does not match the reviewed action.");
    if (input.reviewedDestination && !sameAddress(input.reviewedDestination, effect.recipient)) throw new PreparedActionError("Transfer destination changed since review.");
  } else if (effect.type === "erc20_transfer") {
    if (input.reviewedAsset === "ETH" || !asset.address || !sameAddress(asset.address, effect.token) || !sameAddress(call.to, effect.token) || value !== 0n || BigInt(effect.amountRaw) !== reviewedRaw) throw new PreparedActionError("Token transfer does not match the reviewed action.");
    const expectedData = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [getAddress(effect.recipient), BigInt(effect.amountRaw)] });
    if (call.data.toLowerCase() !== expectedData.toLowerCase()) throw new PreparedActionError("Token transfer calldata does not match the reviewed action.");
    if (input.reviewedDestination && !sameAddress(input.reviewedDestination, effect.recipient)) throw new PreparedActionError("Transfer destination changed since review.");
  }
  return effect;
}

type IntentRow = { intent_id: string; intent_type: string; chain_id: number; wallet_reference: string; request_json: string; policy_result_json: string; status: string; expires_at: string };

function featureFor(type: string): FeatureKey {
  if (type === "swap") return "swaps";
  if (type === "bridge") return "cross_chain";
  if (type.startsWith("earn_") || type === "borrow" || type === "repay") return "defi_actions";
  return "direct_transfers";
}

function reply(body: Record<string, unknown>, status: number) { return Response.json(body, { status, headers: { "Cache-Control": "no-store" } }); }

export async function POST(request: Request) {
  const traceId = crypto.randomUUID();
  try {
    const subject = await requireVerifiedSubject(request);
    const beta = await requireBetaAccess(env.PROJECTION_DB, subject.subjectReference);
    await enforceRateLimit(env.PROJECTION_DB, { namespace: "intent_prepare", subject: subject.subjectReference, limit: 30, windowSeconds: 60 });
    const input = prepareSchema.parse(await request.json());
    const intent = await env.PROJECTION_DB.prepare(`SELECT intent_id, intent_type, chain_id, wallet_reference, request_json, policy_result_json, status, expires_at
      FROM transaction_intents WHERE intent_id = ? AND subject_reference = ?`)
      .bind(input.intentId, subject.subjectReference).first<IntentRow>();
    if (!intent) return reply({ error: "intent_not_found", traceId }, 404);
    const currentTime = new Date();
    const now = currentTime.toISOString();
    if (intent.status !== "reviewed" || intent.expires_at <= now) return reply({ error: "intent_not_reviewed", traceId }, 409);
    const policy = z.object({ permitted: z.literal(true) }).passthrough().safeParse(JSON.parse(intent.policy_result_json));
    if (!policy.success) return reply({ error: "policy_not_permitted", traceId }, 403);
    await requireFeature(env.PROJECTION_DB, featureFor(intent.intent_type));
    const reviewed = z.object({ type: z.enum(["transfer", "swap", "bridge", "earn_supply", "earn_withdraw", "earn_claim", "borrow", "repay"]), chainId: z.number().int().positive(), destination: address, asset: z.string(), amount: z.string(), estimatedUsd: z.number().nonnegative().optional(), availableUsd: z.number().nonnegative().optional() }).passthrough().parse(JSON.parse(intent.request_json));
    if (reviewed.type !== intent.intent_type || reviewed.chainId !== intent.chain_id) return reply({ error: "review_mismatch", traceId }, 409);
    const valuation = await valueTransfer(reviewed, { now: currentTime });
    const [securityRows, addressRows, spentRows] = await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare("SELECT account_locked, enforce_address_book, daily_limit_usd, new_address_threshold_usd, step_up_threshold_usd, new_address_delay_seconds FROM security_profiles WHERE subject_reference = ?").bind(subject.subjectReference),
      env.PROJECTION_DB.prepare("SELECT address, available_at FROM address_book_entries WHERE subject_reference = ? AND chain_family = 'evm'").bind(subject.subjectReference),
      env.PROJECTION_DB.prepare(`SELECT COALESCE(SUM(CAST(v.usd_cents AS INTEGER)), 0) AS spent_cents,
          SUM(CASE WHEN v.valuation_id IS NULL THEN 1 ELSE 0 END) AS missing
        FROM transaction_intents i LEFT JOIN intent_valuations v ON v.rowid =
          (SELECT MAX(v2.rowid) FROM intent_valuations v2 WHERE v2.intent_id = i.intent_id)
        WHERE i.subject_reference = ? AND i.status IN ('submitted', 'confirmed') AND i.created_at >= ?`)
        .bind(subject.subjectReference, new Date(currentTime.getTime() - 86_400_000).toISOString())
    ]);
    const profile = securityRows.results[0] as unknown as { account_locked: number; enforce_address_book: number; daily_limit_usd: number; new_address_threshold_usd: number; step_up_threshold_usd: number; new_address_delay_seconds: number } | undefined;
    if (!profile || profile.account_locked) return reply({ error: "account_locked", traceId }, 403);
    const saved = addressRows.results as unknown as Array<{ address: string; available_at: string }>;
    const spending = spentRows.results[0] as unknown as { spent_cents: number; missing: number } | undefined;
    const spentCents = spending?.spent_cents ?? 0;
    if (Boolean(spending?.missing) || !Number.isSafeInteger(spentCents) || spentCents < 0) return reply({ error: "spent_value_unavailable", traceId }, 403);
    // USD estimates in the reviewed request came from the browser. Value controls
    // require a trusted valuation source before financial flows can be released.
    const decision = evaluateTransactionPolicy({ ...reviewed, estimatedUsd: undefined, availableUsd: undefined }, {
      supportedChainIds: [8453, 1, 42161, 10, 137],
      allowlistedDestinations: saved.filter((entry) => entry.available_at <= now).map((entry) => entry.address),
      coolingDestinations: saved.filter((entry) => entry.available_at > now).map((entry) => entry.address),
      enforceAllowlist: Boolean(profile.enforce_address_book),
      accountLocked: Boolean(profile.account_locked),
      reserveFloorUsd: 10_000,
      dailyLimitUsd: Math.min(profile.daily_limit_usd, beta.transactionLimitUsd),
      spentTodayUsd: spentCents / 100,
      newAddressThresholdUsd: profile.new_address_threshold_usd,
      stepUpThresholdUsd: profile.step_up_threshold_usd,
      delayThresholdUsd: Number.MAX_SAFE_INTEGER,
      delaySeconds: profile.new_address_delay_seconds
    }, currentTime, valuation.usdCents);
    if (!decision.permitted) return reply({ error: "policy_not_permitted", findings: decision.findings.filter((finding) => finding.level === "block"), traceId }, 403);
    // Enrollment or a browser-side MFA modal is not server-verifiable proof that
    // this exact reviewed action passed step-up. Hold these calls until such an
    // attestation is bound to the intent.
    if (decision.requiresStepUp) return reply({ error: "step_up_unavailable", traceId }, 403);
    const ownedAddress = await requireLinkedEvmWallet(subject.subjectReference, input.call.from);
    if (intent.wallet_reference !== `wallet:${ownedAddress}` || input.call.chainId !== intent.chain_id) return reply({ error: "call_not_reviewed", traceId }, 409);
    const effect = validatePreparedAction({ ...input, intentType: intent.intent_type, reviewedDestination: reviewed.destination, reviewedAsset: reviewed.asset, reviewedAmount: reviewed.amount });
    const call = await normalizePreparedCall(input.call);
    await env.PROJECTION_DB.prepare(`INSERT INTO intent_valuations
      (valuation_id, intent_id, asset_id, raw_units, decimals, price_usd, market_price_usd, price_source, price_observed_at, valued_at, usd_cents, policy_version, depeg_uncertainty)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(crypto.randomUUID(), input.intentId, valuation.assetId, valuation.rawUnits,
        valuation.decimals, valuation.priceUsd, valuation.marketPriceUsd, valuation.priceSource, valuation.priceObservedAt,
        valuation.valuedAt, valuation.usdCents, valuation.policyVersion, Number(valuation.depegUncertainty)).run();
    const result = await env.PROJECTION_DB.prepare(`INSERT INTO intent_prepared_calls
      (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value, calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json, verification_state, created_at)
      SELECT i.intent_id, ?, i.subject_reference, ?, ?, ?, ?, ?, ?, ?, ?, i.expires_at, ?, 'prepared', ?
      FROM transaction_intents i WHERE i.intent_id = ? AND i.subject_reference = ? AND i.status = 'reviewed' AND i.expires_at > ?
        AND NOT EXISTS (SELECT 1 FROM security_profiles s WHERE s.subject_reference = i.subject_reference AND s.account_locked = 1)
        AND NOT EXISTS (SELECT 1 FROM intent_prepared_calls p WHERE p.intent_id = i.intent_id AND p.step_index = ?)
        AND (? = 0 OR EXISTS (SELECT 1 FROM intent_prepared_calls prior WHERE prior.intent_id = i.intent_id AND prior.step_index = ? AND prior.verification_state = 'confirmed'))`)
      .bind(input.stepIndex, ownedAddress, call.chainId, call.to.toLowerCase(), call.value, call.dataHash, call.fingerprint, input.semanticAction, input.sourceReference, JSON.stringify(effect), now, input.intentId, subject.subjectReference, now, input.stepIndex, input.stepIndex, input.stepIndex - 1).run();
    if (result.meta.changes !== 1) return reply({ error: "prepare_conflict", traceId }, 409);
    await env.PROJECTION_DB.prepare(`INSERT INTO intent_events (event_id, intent_id, subject_reference, event_type, evidence_json, occurred_at)
      VALUES (?, ?, ?, 'call_prepared', ?, ?)`).bind(crypto.randomUUID(), input.intentId, subject.subjectReference, JSON.stringify({ stepIndex: input.stepIndex, fingerprint: call.fingerprint, semanticAction: input.semanticAction }), now).run();
    return reply({ intentId: input.intentId, stepIndex: input.stepIndex, fingerprint: call.fingerprint, expiresAt: intent.expires_at, traceId }, 201);
  } catch (error) {
    if (error instanceof AuthenticationError) return reply({ error: "unauthorized", traceId }, 401);
    if (error instanceof WalletOwnershipError) return reply({ error: "wallet_not_linked", traceId }, 403);
    if (error instanceof BetaAccessError) return reply({ error: error.code, traceId }, 403);
    if (error instanceof RateLimitError) return reply({ error: "rate_limited", traceId }, 429);
    if (error instanceof FeatureUnavailableError) return reply({ error: "feature_unavailable", traceId }, 503);
    if (error instanceof ValuationError) return reply({ error: "valuation_unavailable", traceId }, 503);
    if (error instanceof PreparedActionError) return reply({ error: "call_not_reviewed", traceId }, 400);
    if (error instanceof z.ZodError) return reply({ error: "invalid_preparation", issues: error.issues, traceId }, 400);
    console.error(JSON.stringify({ level: "error", event: "intent.prepare.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return reply({ error: "prepare_unavailable", traceId }, 503);
  }
}
