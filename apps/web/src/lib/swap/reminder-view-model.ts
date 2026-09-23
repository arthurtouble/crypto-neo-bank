export type ReviewableOccurrence = { fromAssetId: string; toAssetId: string; amount: string; canReview: boolean; disabledReason: string | null };

export function reviewableReminder(occurrence: ReviewableOccurrence): { fromAssetId: string; toAssetId: string; amount: string } | null {
  return occurrence.canReview && !occurrence.disabledReason
    ? { fromAssetId: occurrence.fromAssetId, toAssetId: occurrence.toAssetId, amount: occurrence.amount }
    : null;
}

export function reminderDisabledText(reason: string | null): string {
  if (reason === "account_locked") return "Your account is locked. Review is unavailable.";
  if (reason === "cross_chain_unavailable") return "Swaps across networks are unavailable right now.";
  return "An asset is unavailable for review right now.";
}
