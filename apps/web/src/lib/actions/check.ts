import type { PrivyClient } from "@privy-io/node";
import { readRelayedTransaction, type RelayedTransaction } from "./privy-relay";
import { applyVerification, attachRelayHash, type StoredAction } from "./store";
import { verifyAction, type Verification } from "./verify";

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
    if (status.status === "failed") return applyVerification(db, current, { status: "failed", reason: status.reason }, now);
    if (status.status === "pending") return applyVerification(db, current, { status: "pending", reason: "relay_pending" }, now);
    current = await attachRelayHash(db, current, status.hash, now);
  }
  if (!current.transactionHash) return current;
  const result: Verification = await (dependencies.verify ?? verifyAction)({ chainId: current.chainId, walletAddress: current.wallet,
    calls: current.calls, effects: current.effects, transactionHash: current.transactionHash })
    .catch((error: unknown) => {
      console.error(JSON.stringify({ level: "warn", event: "actions.check.failed", actionId: current.id, message: error instanceof Error ? error.message : "unknown" }));
      return { status: "pending" as const, reason: "check_failed" };
    });
  if (result.status === "pending") console.log(JSON.stringify({ level: "info", event: "actions.check.pending", actionId: current.id, reason: result.reason }));
  return applyVerification(db, current, result, now);
}
