/** Customer wording for a verifier reason. Unknown reasons fall back to a generic line rather than a code. */
export function failureText(reason: string | null): string {
  if (!reason) return "It didn't complete. Check the reason before trying again.";
  if (reason === "refunded") return "The transfer was refunded to your wallet on the original network.";
  if (reason === "partial_delivery") return "It arrived as a different asset. Check your wallet.";
  if (reason === "delivery_below_minimum") return "Less than the minimum arrived. Contact Support.";
  if (reason === "delivery_failed" || reason.startsWith("destination_")) return "Delivery failed. Contact Support before trying again.";
  if (reason === "operation_reverted" || reason === "transaction_reverted") return "The network rejected it. Nothing moved.";
  return "We couldn't match this transaction to what you confirmed. Contact Support.";
}
