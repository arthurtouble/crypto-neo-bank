export type TransactionLifecycleStatus =
  | "reviewing"
  | "awaiting_confirmation"
  | "submitted"
  | "confirmed"
  | "failed"
  | "cancelled";

export const terminalIntentStatuses = new Set(["confirmed", "failed", "cancelled", "blocked"]);

export function normalizeIntentStatus(status: string | null | undefined): TransactionLifecycleStatus | null {
  if (status === "confirmed") return "confirmed";
  if (status === "failed" || status === "blocked") return "failed";
  if (status === "cancelled") return "cancelled";
  if (status === "submitted") return "submitted";
  return null;
}

/** A historical status alone is not independent settlement evidence. */
export function normalizeVerifiedIntentStatus(status: string | null | undefined, verificationState: string | null | undefined): TransactionLifecycleStatus | null {
  if (status === "confirmed" && verificationState !== "confirmed") return "submitted";
  return normalizeIntentStatus(status);
}

export function bridgeProgressDetail(state: string | null | undefined): string | null {
  switch (state) {
    case "source_confirmed_pending_settlement":
      return "The first transaction is confirmed. We’re waiting for delivery.";
    case "pending":
    case "reported": return "We’re waiting for the first transaction to be confirmed.";
    case "partial": return "Less than the minimum arrived. We’re reviewing this transfer.";
    case "refund_reported": return "A refund was reported but is not yet verified. Do not send again.";
    case "failed":
    case "inconsistent":
    case "reorged": return "We couldn’t verify delivery. Please contact support before trying again.";
    default: return null;
  }
}

export function lifecycleStep(status: TransactionLifecycleStatus) {
  if (status === "reviewing") return 0;
  if (status === "awaiting_confirmation") return 1;
  if (status === "submitted") return 2;
  return 3;
}

export function lifecycleCopy(status: TransactionLifecycleStatus, action: string) {
  if (status === "reviewing") return { title: `Reviewing ${action.toLowerCase()}`, detail: "Running policy and transaction checks." };
  if (status === "awaiting_confirmation") return { title: "Waiting for your confirmation", detail: "Review the request in your wallet before approving it." };
  if (status === "submitted") return { title: `${action} submitted`, detail: "Your request is on its way. You can leave this screen." };
  if (status === "confirmed") return { title: `${action} complete`, detail: "The network has confirmed your transaction." };
  if (status === "cancelled") return { title: `${action} cancelled`, detail: "Nothing else will be submitted from this request." };
  return { title: `${action} failed`, detail: "The transaction did not complete. Review the reason before trying again." };
}
