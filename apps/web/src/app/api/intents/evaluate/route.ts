import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { evaluateTransactionPolicy } from "@/lib/transactions/policy";

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
    const input = intentSchema.parse(await request.json());
    const decision = evaluateTransactionPolicy(input);
    const now = new Date();
    const intentId = crypto.randomUUID();
    const walletReference = `wallet:${input.walletAddress.toLowerCase()}`;

    await env.PROJECTION_DB.batch([
      env.PROJECTION_DB.prepare(`INSERT INTO subject_profiles
        (subject_reference, privy_user_reference, onboarding_state, created_at, updated_at)
        VALUES (?, ?, 'wallet_ready', ?, ?)
        ON CONFLICT(subject_reference) DO UPDATE SET updated_at = excluded.updated_at`)
        .bind(subject.subjectReference, subject.subjectReference, now.toISOString(), now.toISOString()),
      env.PROJECTION_DB.prepare(`INSERT INTO wallet_references
        (wallet_reference, subject_reference, provider, provider_wallet_reference, address, chain_family, control_model, observed_at)
        VALUES (?, ?, 'privy', NULL, ?, 'evm', 'user-controlled', ?)
        ON CONFLICT(subject_reference, address) DO UPDATE SET observed_at = excluded.observed_at`)
        .bind(walletReference, subject.subjectReference, input.walletAddress.toLowerCase(), now.toISOString()),
      env.PROJECTION_DB.prepare(`INSERT INTO transaction_intents
        (intent_id, subject_reference, wallet_reference, intent_type, chain_id, request_json, policy_result_json, disclosure_version, status, created_at, updated_at, expires_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(intentId, subject.subjectReference, walletReference, input.type, input.chainId, JSON.stringify(input), JSON.stringify(decision), input.disclosureVersion, decision.permitted ? "reviewed" : "blocked", now.toISOString(), now.toISOString(), new Date(now.getTime() + 15 * 60_000).toISOString())
    ]);

    return Response.json({ intentId, decision, traceId }, { status: decision.permitted ? 201 : 422, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", message: error.message, traceId }, { status: 401 });
    if (error instanceof z.ZodError) return Response.json({ error: "invalid_intent", issues: error.issues, traceId }, { status: 400 });
    console.error(JSON.stringify({ level: "error", event: "intent.evaluate.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
    return Response.json({ error: "intent_unavailable", message: "The transaction could not be reviewed.", traceId }, { status: 503 });
  }
}

