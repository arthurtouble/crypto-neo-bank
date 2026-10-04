import type { PrivyClient } from "@privy-io/node";
import { readRelayedTransaction, type RelayedTransaction } from "./privy-relay";
import { nativeCreditEvidenceSchema, type NativeCreditEvidence } from "./native-credit";
import { appendEvidenceOnce, applyVerification, attachRelayHash, listActionEvents, type StoredAction } from "./store";
import { verifyAction, type Verification } from "./verify";

/**
 * Notify the customer once when their action finishes: complete (a
 * same-network action in a block and matching, or a move that arrived) or
 * failed. A bank transfer is complete when the bank has it, so only its failure is announced here. Notices are recorded with the check and delivered in the background.
 */
async function announce(db: D1Database, before: StoredAction, after: StoredAction, now: Date): Promise<StoredAction> {
  if (before.status === after.status) return after;
  const outcome = after.status === "failed" ? "failed"
    : after.status === "confirmed" || (after.status === "settling" && !after.destinationChainId) ? "completed" : null;
  if (!outcome) return after;
  const [{ actionNotice }, notices] = await Promise.all([import("@/lib/notifications/store"), import("@/lib/notifications/deliver")]);
  // A bank transfer has no notice when it's funded on Base: the bank's answer is its notice (lib/money/bank-activity.ts).
  const notice = actionNotice(after, outcome);
  if (notice) await notices.announce(db, after.subject, notice, now);
  return after;
}

/** Native credit observed by earlier checks, for an action that pays out native ETH. Malformed rows are ignored. */
async function storedNativeEvidence(db: D1Database, action: StoredAction): Promise<NativeCreditEvidence[] | null> {
  const native = action.effects.some((effect) => effect.type === "native_credit_min" || (effect.type === "delivery" && effect.token === null));
  if (!native) return null;
  return (await listActionEvents(db, action.id)).filter((event) => event.type === "native_credit")
    .flatMap((event) => { const parsed = nativeCreditEvidenceSchema.safeParse(event.evidence); return parsed.success ? [parsed.data] : []; });
}

export type CheckDependencies = {
  verify?: typeof verifyAction;
  relayStatus?: (reference: string) => Promise<RelayedTransaction>;
  privy?: () => PrivyClient;
};

/**
 * Advance one submitted or settling action. A relayed action first needs its
 * chain hash from Privy; after that, the chain alone decides. Any read that
 * fails counts as a check, so it is retried later and never changes the outcome.
 */
export async function checkAction(db: D1Database, action: StoredAction, now: Date, dependencies: CheckDependencies = {}): Promise<StoredAction> {
  let current = action;
  if (!current.transactionHash && current.relayReference) {
    const reference = current.relayReference;
    const status = await (dependencies.relayStatus ?? (async (id: string) => {
      const { privyClient } = await import("@/lib/auth/privy");
      return readRelayedTransaction((dependencies.privy ?? privyClient)(), id);
    }))(reference).catch((): RelayedTransaction => ({ status: "pending" }));
    if (status.status === "failed") {
      // Privy's answer alone isn't chain evidence. Until the signed request has expired with no hash, it could still be
      // sent, so the action stays submitted and keeps being checked; only then does it fail.
      if (now.getTime() <= Date.parse(current.expiresAt)) {
        await appendEvidenceOnce(db, current.id, "relay_failed", { reason: status.reason }, now);
        return applyVerification(db, current, { status: "pending", reason: "relay_failed" }, now);
      }
      return announce(db, action, await applyVerification(db, current, { status: "failed", reason: status.reason }, now), now);
    }
    if (status.status === "pending") return applyVerification(db, current, { status: "pending", reason: "relay_pending" }, now);
    current = await attachRelayHash(db, current, status.hash, now);
    // The hash is already linked to another action: recorded as evidence, and checked again later.
    if (!current.transactionHash) return applyVerification(db, current, { status: "pending", reason: "hash_in_use" }, now);
  }
  if (!current.transactionHash) return current;
  const nativeEvidence = await storedNativeEvidence(db, current);
  const result: Verification = await (dependencies.verify ?? verifyAction)({ chainId: current.chainId, walletAddress: current.wallet,
    calls: current.calls, effects: current.effects, transactionHash: current.transactionHash, ...(nativeEvidence ? { nativeEvidence } : {}) })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ level: "warn", event: "actions.check.failed", actionId: current.id, message: error instanceof Error ? error.message : "unknown" }));
      return { status: "pending" as const, reason: "check_failed" };
    });
  // A native payout's chain reading is kept as evidence, so later checks don't need the endpoint to still hold that block's history.
  if (result.nativeCredit) await appendEvidenceOnce(db, current.id, "native_credit", result.nativeCredit, now);
  if (result.status === "pending") console.log(JSON.stringify({ level: "info", event: "actions.check.pending", actionId: current.id, reason: result.reason }));
  return announce(db, action, await applyVerification(db, current, result, now), now);
}
