import type { ProductSession } from "./providers/session";

export type ReconciliationReport = {
  subjectReference: string;
  checkedAt: string;
  status: "balanced" | "attention";
  sourceCount: number;
  staleSourceCount: number;
  issues: Array<{ code: string; severity: "info" | "warning"; message: string }>;
};

export function reconcileSession(session: ProductSession): ReconciliationReport {
  const staleSourceCount = session.positions.filter((position) => position.source.status !== "confirmed").length;
  const issues: ReconciliationReport["issues"] = [];
  if (staleSourceCount) issues.push({ code: "source_not_confirmed", severity: "warning", message: `${staleSourceCount} position source${staleSourceCount === 1 ? " is" : "s are"} not confirmed.` });
  if (session.compliance.status !== "approved") issues.push({ code: "regulated_features_locked", severity: "info", message: "Regulated features remain locked by the compliance provider." });
  if (session.wallets.some((wallet) => !wallet.recoveryReady)) issues.push({ code: "recovery_incomplete", severity: "warning", message: "Wallet recovery is not fully configured." });
  return { subjectReference: session.profile.subjectReference, checkedAt: new Date().toISOString(), status: issues.some((issue) => issue.severity === "warning") ? "attention" : "balanced", sourceCount: session.positions.length, staleSourceCount, issues };
}
