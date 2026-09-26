import { AssetUnavailableError } from "@/lib/http/errors";
import { assetFor, registeredAsset, type AssetUse, type RegisteredAsset } from "./registry";

/** Assets an operator paused, with the reason. */
export async function pausedAssets(db: D1Database): Promise<Map<string, string>> {
  const rows = await db.prepare("SELECT asset_id, reason FROM asset_pauses").all<{ asset_id: string; reason: string }>();
  return new Map(rows.results.map((row) => [row.asset_id, row.reason]));
}

/** Refuse a money movement in a paused asset. Every action is checked here before it is stored. */
export async function requireNotPaused(db: D1Database, assetId: string): Promise<void> {
  const paused = await db.prepare("SELECT asset_id FROM asset_pauses WHERE asset_id = ?").bind(assetId.toLowerCase()).first<{ asset_id: string }>();
  if (!paused) return;
  const symbol = registeredAsset(assetId)?.symbol ?? "This asset";
  throw new AssetUnavailableError("asset_paused", `${symbol} is paused right now. Try again later.`);
}

/**
 * The registered asset for a money movement, refusing one outside the
 * registry, not allowed for this use, or paused. Every server path that moves
 * money checks this; the screens only mirror it.
 */
export async function requireAsset(db: D1Database, id: string, use: AssetUse): Promise<RegisteredAsset> {
  const asset = assetFor(id, use);
  if (!asset) throw new AssetUnavailableError("unsupported_asset", "This asset isn't supported here.");
  const paused = await db.prepare("SELECT reason FROM asset_pauses WHERE asset_id = ?").bind(asset.id).first<{ reason: string }>();
  if (paused) throw new AssetUnavailableError("asset_paused", `${asset.symbol} is paused right now. Try again later.`);
  return asset;
}
