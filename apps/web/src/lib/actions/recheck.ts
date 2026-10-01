import { checkAction, type CheckDependencies } from "./check";
import { expireStalePrepared, listDueActions } from "./store";
import { verifyAction } from "./verify";

/** How long an open action waits between background checks. */
const RECHECK_INTERVAL_MS = 60_000;
/** Actions checked per run. Each check makes a handful of public RPC reads, so runs stay small and frequent. */
const RECHECK_BATCH = 20;

type RecheckSummary = { checked: number; advanced: number; failedChecks: number; expired: number };

/**
 * Advance open actions from chain evidence without waiting for the customer
 * to look at them. Runs from the Worker's cron; the result is the same one
 * reading the action would produce.
 */
export async function recheckOpenActions(db: D1Database, now: Date, dependencies: CheckDependencies & { check?: typeof checkAction } = {}): Promise<RecheckSummary> {
  const expired = await expireStalePrepared(db, now);
  const due = await listDueActions(db, new Date(now.getTime() - RECHECK_INTERVAL_MS), RECHECK_BATCH);
  let advanced = 0;
  let failedChecks = 0;
  const { check = checkAction, ...checkDependencies } = dependencies;
  // One at a time, so a burst of open actions doesn't hit public RPC limits.
  for (const action of due) {
    const verify = checkDependencies.verify ?? verifyAction;
    try {
      const updated = await check(db, action, now, { ...checkDependencies, verify: async (input) => {
        try { return await verify(input); } catch (error) { failedChecks += 1; throw error; }
      } });
      if (updated.status !== action.status) advanced += 1;
    } catch (error) {
      // One action that can't be checked never stops the rest; it is tried again on a later run.
      failedChecks += 1;
      console.error(JSON.stringify({ level: "warn", event: "actions.recheck.failed", actionId: action.id, message: error instanceof Error ? error.message : "unknown" }));
    }
  }
  return { checked: due.length, advanced, failedChecks, expired };
}
