import { env } from "cloudflare:workers";
import { z } from "zod";
import { requireOperator } from "@/lib/auth/access";
import { ASSETS, registeredAsset } from "@/lib/assets/registry";
import { route } from "@/lib/http/route";

const updateSchema = z.strictObject({
  assetId: z.string().max(80),
  paused: z.boolean(),
  reason: z.string().trim().min(1).max(240).optional()
}).refine((input) => !input.paused || input.reason, { message: "Give a reason for pausing." });

const options = { invalid: "invalid_asset_pause", unavailable: "asset_pauses_unavailable" };

/** The registry, with each asset's pause state. */
export const GET = route("ops.assets.get", options, async (request: Request, { traceId }) => {
  await requireOperator(request);
  const rows = await env.PROJECTION_DB.prepare("SELECT asset_id, reason, paused_at, paused_by FROM asset_pauses")
    .all<{ asset_id: string; reason: string; paused_at: string; paused_by: string }>();
  const pauses = new Map(rows.results.map((row) => [row.asset_id, row]));
  return Response.json({ assets: ASSETS.map((asset) => {
    const pause = pauses.get(asset.id);
    return { ...asset, paused: pause ? { reason: pause.reason, at: pause.paused_at, by: pause.paused_by } : null };
  }), traceId });
});

/** Pause or resume one registered asset. Adding assets is a reviewed code change, never an API call. */
export const PATCH = route("ops.assets.patch", options, async (request: Request, { traceId }) => {
  const operator = await requireOperator(request);
  const input = updateSchema.parse(await request.json());
  const asset = registeredAsset(input.assetId);
  if (!asset) return Response.json({ error: "unknown_asset", message: "Only assets in the registry can be paused.", traceId }, { status: 404 });
  const now = new Date().toISOString();
  const db = env.PROJECTION_DB;
  await db.batch([
    input.paused
      ? db.prepare(`INSERT INTO asset_pauses (asset_id, reason, paused_at, paused_by) VALUES (?, ?, ?, ?)
          ON CONFLICT(asset_id) DO UPDATE SET reason = excluded.reason, paused_at = excluded.paused_at, paused_by = excluded.paused_by`)
        .bind(asset.id, input.reason!, now, operator.email)
      : db.prepare("DELETE FROM asset_pauses WHERE asset_id = ?").bind(asset.id),
    db.prepare(`INSERT INTO audit_events (audit_id, subject_reference, actor_type, actor_reference, action, target_type, target_reference, evidence_json, occurred_at)
      VALUES (?, NULL, 'operator', ?, ?, 'asset', ?, ?, ?)`)
      .bind(crypto.randomUUID(), operator.email, input.paused ? "asset.paused" : "asset.resumed", asset.id,
        JSON.stringify({ reason: input.reason ?? null }), now)
  ]);
  return Response.json({ updated: true, traceId });
});
