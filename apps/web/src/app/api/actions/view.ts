import type { StoredAction } from "@/lib/actions/store";

/** What the browser sees of an action. Calls are only included while they can still be signed. */
export function actionView(action: StoredAction) {
  return {
    id: action.id, kind: action.kind, chainId: action.chainId, status: action.status, summary: action.summary,
    calls: action.status === "prepared" ? action.calls : undefined,
    usdCents: action.usdCents, transactionHash: action.transactionHash,
    destinationChainId: action.destinationChainId, destinationTransactionHash: action.destinationTransactionHash,
    failureReason: action.failureReason, createdAt: action.createdAt, expiresAt: action.expiresAt,
    submittedAt: action.submittedAt, settledAt: action.settledAt
  };
}
