import { requireNotPaused } from "@/lib/assets/pauses";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { morphoVault } from "@/lib/defi/morpho";
import { requireFeature, type FeatureKey } from "@/lib/features/flags";
import { checkControls, insertAction, loadControls, type Block } from "./controls";
import { buildEarn, earnInputSchema } from "./earn";
import { buildRoute, markQuoteUsed, routeInputSchema } from "./route";
import { getAction, type StoredAction } from "./store";
import { buildTransfer, transferInputSchema } from "./transfer";
import { callsFingerprint, type BuiltAction } from "./types";
import { valueAsset } from "./valuation";
import { z } from "zod";

export const actionInputSchema = z.discriminatedUnion("kind", [transferInputSchema, earnInputSchema, routeInputSchema]);
export type ActionInput = z.infer<typeof actionInputSchema>;

/** The switches a swap or cross-network move needs. A route that pays someone else is a send, so the send switch applies too. */
export function routeFeatures(route: { crossChain: boolean; external: boolean }): FeatureKey[] {
  return [route.crossChain ? "cross_chain" : "swaps", ...(route.external ? ["direct_transfers" as const] : [])];
}

function featureFor(action: BuiltAction): FeatureKey | FeatureKey[] {
  if (action.kind === "transfer") return "direct_transfers";
  if (action.kind === "earn") return "defi_actions";
  return routeFeatures({ crossChain: Boolean(action.destinationChainId), external: Boolean(action.recipient) });
}

function build(db: D1Database, input: ActionInput, subject: string, wallet: string, now: Date): Promise<BuiltAction> {
  if (input.kind === "transfer") return buildTransfer(db, input, wallet);
  if (input.kind === "earn") return buildEarn(input, wallet);
  return buildRoute(db, input, subject, wallet, now);
}

/** Wait for every check, then throw the first failure in list order, so parallel reads keep a stable answer. */
async function inOrder(checks: Array<Promise<unknown>>): Promise<void> {
  for (const result of await Promise.allSettled(checks)) if (result.status === "rejected") throw result.reason;
}

/**
 * Refuse when one of the action's switches is off or one of its assets is
 * paused. The reads run together; the first refusal, in this order, is the answer.
 */
export async function requireAllowed(db: D1Database, features: readonly FeatureKey[], assetIds: string | null | readonly (string | null)[]): Promise<void> {
  const assets = [assetIds].flat().filter((id): id is string => typeof id === "string" && id.length > 0);
  await inOrder([...features.map((key) => requireFeature(db, key)), ...assets.map((id) => requireNotPaused(db, id))]);
}

/** The asset a swap or move delivers. An operator can pause it as well as the one it spends. */
function destinationAsset(summary: Record<string, unknown>): string | null {
  const to = summary.to as { id?: unknown } | null | undefined;
  return to && typeof to === "object" && typeof to.id === "string" ? to.id : null;
}

/** The switches and the assets a stored action needs, the same ones it was prepared under. */
export function storedActionGates(action: StoredAction): { features: FeatureKey[]; assetIds: string[] } {
  const summary = action.summary as { assetId?: unknown; bankPayout?: unknown; cardAllowance?: unknown; external?: unknown; from?: { id?: unknown };
    protocol?: unknown; symbol?: unknown; vault?: unknown };
  const text = (value: unknown) => typeof value === "string" ? value : null;
  const assets = (...ids: Array<string | null>) => ids.filter((id): id is string => id !== null);
  if (action.kind === "route") return { features: routeFeatures({ crossChain: Boolean(action.destinationChainId), external: summary.external === true }),
    assetIds: assets(text(summary.from?.id), destinationAsset(action.summary)) };
  if (action.kind === "earn") {
    const asset = summary.protocol === "morpho" ? morphoVault(text(summary.vault) ?? "")?.asset ?? BASE_USDC
      : AAVE_BASE_ASSETS[text(summary.symbol) as keyof typeof AAVE_BASE_ASSETS];
    return { features: ["defi_actions"], assetIds: assets(asset ? `${BASE_CHAIN_ID}:${asset.toLowerCase()}` : null) };
  }
  return { features: [summary.bankPayout ? "fiat_accounts" : summary.cardAllowance ? "payment_cards" : "direct_transfers"], assetIds: assets(text(summary.assetId)) };
}

export type Prepared = { ok: true; action: StoredAction } | { ok: false; block: Block };

/** Build, check, value, and store an action for the customer to sign. */
export async function prepareAction(db: D1Database, subject: string, wallet: string, input: ActionInput, now = new Date()): Promise<Prepared> {
  return prepareBuiltAction(db, subject, wallet, await build(db, input, subject, wallet, now), featureFor, now);
}

/** The customer's controls for an action, checked before any provider is asked to do anything. */
export async function precheckAction(db: D1Database, subject: string, built: BuiltAction, now = new Date()): Promise<Block | null> {
  return checkControls(built, await valueAsset(built.valuation, { now }), await loadControls(db, subject, built.recipient ?? null, now));
}

/** Check, value, and store an action built elsewhere, such as a bank payout's funding transfer. */
export async function prepareBuiltAction(db: D1Database, subject: string, wallet: string, built: BuiltAction,
  feature: (action: BuiltAction) => FeatureKey | FeatureKey[], now = new Date()): Promise<Prepared> {
  // A swap or move is also refused when the asset it delivers is paused.
  await requireAllowed(db, [feature(built)].flat(), [built.valuation.assetId, built.kind === "route" ? destinationAsset(built.summary) : null]);
  const [valuation, controls] = await Promise.all([valueAsset(built.valuation, { now }), loadControls(db, subject, built.recipient ?? null, now)]);
  const block = checkControls(built, valuation, controls);
  if (block) return { ok: false, block };
  const id = await insertAction(db, {
    subject, wallet, kind: built.kind, chainId: built.chainId, summary: built.summary, calls: built.calls,
    callsFingerprint: await callsFingerprint(built.chainId, built.calls), effects: built.effects,
    countsTowardLimit: built.countsTowardLimit, usdCents: valuation.usdCents, valuationSource: valuation.source,
    routeQuoteId: built.routeQuoteId ?? null, destinationChainId: built.destinationChainId ?? null
  }, now);
  if (id === "quote_used") return { ok: false, block: { code: "quote_used", message: "This quote was already used. Get a new one." } };
  if (!id) {
    // Something changed between the check and the insert: a lock, or another action using the limit.
    const again = checkControls(built, valuation, await loadControls(db, subject, built.recipient ?? null, now));
    return { ok: false, block: again ?? { code: "try_again", message: "Your limits changed. Try again." } };
  }
  if (built.routeQuoteId) await markQuoteUsed(db, built.routeQuoteId, id);
  const action = await getAction(db, subject, id);
  if (!action) throw new Error("Prepared action was not stored.");
  return { ok: true, action };
}
