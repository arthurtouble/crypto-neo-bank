import { applyVerification, expireStalePrepared, listDueActions } from "./store";
import { verifyAction } from "./verify";

/** How long an open action waits between background checks. */
export const RECHECK_INTERVAL_MS = 60_000;
/** Actions checked per run. Each check makes a handful of public RPC reads, so runs stay small and frequent. */
export const RECHECK_BATCH = 20;

export type RecheckSummary = { checked: number; advanced: number; failedChecks: number; expired: number };

/**
 * Advance open actions from chain evidence without waiting for the customer
 * to look at them. Runs from the Worker's cron; the result is the same one
 * reading the action would produce.
 */
export async function recheckOpenActions(db: D1Database, now: Date, verify: typeof verifyAction = verifyAction): Promise<RecheckSummary> {
  const expired = await expireStalePrepared(db, now);
  const due = await listDueActions(db, new Date(now.getTime() - RECHECK_INTERVAL_MS), RECHECK_BATCH);
  let advanced = 0;
  let failedChecks = 0;
  // One at a time, so a burst of open actions doesn't hit public RPC limits.
  for (const action of due) {
    const result = await verify({ chainId: action.chainId, walletAddress: action.wallet, calls: action.calls,
      effects: action.effects, transactionHash: action.transactionHash! }).catch(() => {
      failedChecks += 1;
      return { status: "pending" as const, reason: "check_failed" };
    });
    const updated = await applyVerification(db, action, result, now);
    if (updated.status !== action.status) advanced += 1;
  }
  return { checked: due.length, advanced, failedChecks, expired };
}
