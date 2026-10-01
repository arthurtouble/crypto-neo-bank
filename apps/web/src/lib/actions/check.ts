import type { PrivyClient } from "@privy-io/node";
import { readRelayedTransaction, type RelayedTransaction } from "./privy-relay";
import { appendEvidenceOnce, applyVerification, attachRelayHash, type StoredAction } from "./store";
import { verifyAction, type Verification } from "./verify";

/**
 * Notify the customer once when their action finishes: complete (a
 * same-network action in a block and matching, or a move that arrived) or
 * failed. Notices are recorded with the check and delivered in the background.
 */
async function announce(db: D1Database, before: StoredAction, after: StoredAction, now: Date): Promise<StoredAction> {
  if (before.status === after.status) return after;
  const outcome = after.status === "failed" ? "failed"
    : after.status === "confirmed" || (after.status === "settling" && !after.destinationChainId) ? "completed" : null;
  if (!outcome) return after;
  const [{ actionNotice }, notices] = await Promise.all([import("@/lib/notifications/store"), import("@/lib/notifications/deliver")]);
  await notices.announce(db, after.subject, actionNotice(after, outcome), now);
  return after;
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
  const result: Verification = await (dependencies.verify ?? verifyAction)({ chainId: current.chainId, walletAddress: current.wallet,
    calls: current.calls, effects: current.effects, transactionHash: current.transactionHash })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ level: "warn", event: "actions.check.failed", actionId: current.id, message: error instanceof Error ? error.message : "unknown" }));
      return { status: "pending" as const, reason: "check_failed" };
    });
  if (result.status === "pending") console.log(JSON.stringify({ level: "info", event: "actions.check.pending", actionId: current.id, reason: result.reason }));
  return announce(db, action, await applyVerification(db, current, result, now), now);
}
