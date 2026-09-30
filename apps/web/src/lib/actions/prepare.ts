import { requireNotPaused } from "@/lib/assets/pauses";
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
  // The switches and the pause are read together; the first one that refuses, in this order, is the answer.
  await inOrder([...[feature(built)].flat().map((key) => requireFeature(db, key)), requireNotPaused(db, built.valuation.assetId)]);
  const [valuation, controls] = await Promise.all([valueAsset(built.valuation, { now }), loadControls(db, subject, built.recipient ?? null, now)]);
  const block = checkControls(built, valuation, controls);
  if (block) return { ok: false, block };
  const id = await insertAction(db, {
    subject, wallet, kind: built.kind, chainId: built.chainId, summary: built.summary, calls: built.calls,
    callsFingerprint: await callsFingerprint(built.chainId, built.calls), effects: built.effects,
    countsTowardLimit: built.countsTowardLimit, usdCents: valuation.usdCents, valuationSource: valuation.source,
    routeQuoteId: built.routeQuoteId ?? null, destinationChainId: built.destinationChainId ?? null
  }, now);
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
