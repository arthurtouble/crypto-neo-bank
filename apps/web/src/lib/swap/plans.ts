import type { ServerHeldLifiPlan } from "@/lib/swap/lifi";

const RETENTION_MS = 7 * 86_400_000;

export type StoredSwapQuotePlan = {
  plan_id: string; subject_reference: string; wallet_address: string;
  source_asset_id: string; destination_asset_id: string;
  source_chain_id: number; destination_chain_id: number;
  from_amount_raw: string; recipient: string; slippage_bps: number; to_amount_min_raw: string;
  quote_id: string; step_id: string; tool_id: string; approval_spender: string | null;
  route_steps_json: string;
  source_call_json: string; route_policy_version: string; catalog_version: string;
  observed_at: string; expires_at: string; fingerprint: string; status: "active" | "expired" | "superseded";
  intent_id: string | null;
};

export async function saveSwapQuotePlan(db: D1Database, subject: string, wallet: string, plan: ServerHeldLifiPlan, now = Date.now()): Promise<string> {
  if (!Number.isFinite(Date.parse(plan.expiresAt)) || Date.parse(plan.expiresAt) <= now) throw new Error("Swap quote expired before it could be retained.");
  const planId = crypto.randomUUID();
  const normalizedWallet = wallet.toLowerCase();
  await db.batch([
    db.prepare("UPDATE swap_quote_plans SET status = 'expired' WHERE status = 'active' AND expires_at <= ? AND intent_id IS NULL")
      .bind(new Date(now).toISOString()),
    db.prepare("DELETE FROM swap_quote_plans WHERE status != 'active' AND expires_at < ? AND intent_id IS NULL")
      .bind(new Date(now - RETENTION_MS).toISOString()),
    db.prepare(`UPDATE swap_quote_plans SET status = 'superseded'
      WHERE subject_reference = ? AND wallet_address = ? AND source_asset_id = ? AND destination_asset_id = ?
        AND status = 'active' AND intent_id IS NULL`)
      .bind(subject, normalizedWallet, plan.fromAssetId, plan.toAssetId),
    db.prepare(`INSERT INTO swap_quote_plans (
      plan_id, subject_reference, wallet_address, source_asset_id, destination_asset_id, source_chain_id, destination_chain_id,
      from_amount_raw, recipient, slippage_bps, to_amount_min_raw, quote_id, step_id, tool_id, approval_spender, route_steps_json,
      source_call_json, route_policy_version, catalog_version, observed_at, expires_at, fingerprint
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(planId, subject, normalizedWallet, plan.fromAssetId, plan.toAssetId, plan.fromChainId, plan.toChainId,
        plan.fromAmountRaw, plan.recipient.toLowerCase(), plan.slippageBps, plan.toAmountMinRaw,
        plan.quoteId, plan.stepId, plan.toolId, plan.approvalSpender, JSON.stringify(plan.routeSteps),
        JSON.stringify(plan.sourceCall), plan.routePolicyVersion, plan.catalogVersion,
        plan.observedAt, plan.expiresAt, plan.fingerprint)
  ]);
  return planId;
}

export async function getActiveSwapQuotePlan(db: D1Database, planId: string, subject: string, wallet: string, now = Date.now()): Promise<StoredSwapQuotePlan | null> {
  return db.prepare(`SELECT * FROM swap_quote_plans
    WHERE plan_id = ? AND subject_reference = ? AND wallet_address = ? AND status = 'active' AND expires_at > ?`)
    .bind(planId, subject, wallet.toLowerCase(), new Date(now).toISOString()).first<StoredSwapQuotePlan>();
}
