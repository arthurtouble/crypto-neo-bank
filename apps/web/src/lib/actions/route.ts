import { z } from "zod";
import { callSchema, effectSchema, type BuiltAction } from "./types";
import { ActionInputError } from "./transfer";
import type { ValidatedRoute } from "./lifi";
import type { CatalogAsset } from "@/lib/swap/assets";

export const routeInputSchema = z.strictObject({ kind: z.literal("route"), quoteId: z.uuid() });
export type RouteInput = z.infer<typeof routeInputSchema>;

type QuoteRow = { quote_id: string; wallet_address: string; from_asset_id: string; to_asset_id: string; from_chain_id: number;
  to_chain_id: number; from_amount_raw: string; to_amount_raw: string; to_amount_min_raw: string; tool: string;
  calls_json: string; economics_json: string; expires_at: string; action_id: string | null };

type Economics = ValidatedRoute["economics"] & { from: Pick<CatalogAsset, "id" | "symbol" | "decimals">;
  to: Pick<CatalogAsset, "id" | "symbol" | "decimals">; recipient: string; effects: unknown };

/** Keep a validated LI.FI quote server-side and hand the browser only its ID. */
export async function saveRouteQuote(db: D1Database, input: { subject: string; wallet: string; from: CatalogAsset; to: CatalogAsset;
  recipient: string; route: ValidatedRoute }, now: Date): Promise<string> {
  const id = crypto.randomUUID();
  const economics: Economics = { ...input.route.economics, recipient: input.recipient.toLowerCase(), effects: input.route.effects,
    from: { id: input.from.id, symbol: input.from.symbol, decimals: input.from.decimals },
    to: { id: input.to.id, symbol: input.to.symbol, decimals: input.to.decimals } };
  await db.batch([
    db.prepare("DELETE FROM route_quotes WHERE action_id IS NULL AND expires_at < ?").bind(now.toISOString()),
    db.prepare(`INSERT INTO route_quotes (quote_id, subject_reference, wallet_address, from_asset_id, to_asset_id, from_chain_id,
        to_chain_id, from_amount_raw, to_amount_raw, to_amount_min_raw, tool, calls_json, economics_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(id, input.subject, input.wallet.toLowerCase(), input.from.id, input.to.id, input.from.chainId, input.to.chainId,
        input.route.fromAmountRaw, input.route.toAmountRaw, input.route.toAmountMinRaw, input.route.tool,
        JSON.stringify(input.route.calls), JSON.stringify(economics), now.toISOString(), input.route.expiresAt)
  ]);
  return id;
}

/** Turn a fresh, unused, server-held quote into a route action. */
export async function buildRoute(db: D1Database, input: RouteInput, subject: string, wallet: string, now: Date): Promise<BuiltAction> {
  const row = await db.prepare("SELECT * FROM route_quotes WHERE quote_id = ? AND subject_reference = ?")
    .bind(input.quoteId, subject).first<QuoteRow>();
  if (!row || row.wallet_address !== wallet.toLowerCase()) throw new ActionInputError("quote_not_found", "This quote isn't available. Get a new one.");
  if (row.action_id) throw new ActionInputError("quote_used", "This quote was already used. Get a new one.");
  if (row.expires_at <= now.toISOString()) throw new ActionInputError("quote_expired", "This quote expired. Get a new one.");
  const economics = JSON.parse(row.economics_json) as Economics;
  const recipient = economics.recipient.toLowerCase() as `0x${string}`;
  const external = recipient !== wallet.toLowerCase();
  return {
    kind: "route", chainId: row.from_chain_id,
    calls: callSchema.array().parse(JSON.parse(row.calls_json)),
    effects: effectSchema.array().parse(economics.effects),
    summary: { from: economics.from, to: economics.to, fromAmountRaw: row.from_amount_raw, toAmountRaw: row.to_amount_raw,
      toAmountMinRaw: row.to_amount_min_raw, tool: row.tool, recipient, external, fromAmountUsd: economics.fromAmountUsd,
      networkFeeUsd: economics.networkFeeUsd, providerFeeUsd: economics.providerFeeUsd, priceImpactPercent: economics.priceImpactPercent },
    // Swapping or moving between the customer's own balances is not spending.
    countsTowardLimit: external,
    valuation: { assetId: row.from_asset_id, amountRaw: row.from_amount_raw, decimals: economics.from.decimals, quotedUsd: economics.fromAmountUsd },
    recipient: external ? recipient : undefined,
    routeQuoteId: row.quote_id,
    destinationChainId: row.to_chain_id === row.from_chain_id ? undefined : row.to_chain_id
  };
}

export async function markQuoteUsed(db: D1Database, quoteId: string, actionId: string) {
  await db.prepare("UPDATE route_quotes SET action_id = ? WHERE quote_id = ? AND action_id IS NULL").bind(actionId, quoteId).run();
}
