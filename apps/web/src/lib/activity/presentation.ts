export type ActivityCategory = "Transfers" | "Earn" | "Borrow" | "Swaps" | "Other";

const labels: Record<string, string> = {
  transfer: "Sent",
  bridge: "Moved between networks",
  earn_supply: "Added to Earn",
  earn_withdraw: "Withdrawn from Earn",
  earn_claim: "Claimed rewards",
  borrow: "Borrowed",
  repay: "Repaid",
  liquidation: "Collateral liquidated",
  collateral_enabled: "Enabled collateral",
  collateral_disabled: "Disabled collateral",
  defi_activity: "DeFi activity"
};

export function activityLabel(type: string) {
  return labels[type] ?? type.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function activityCategory(type: string): ActivityCategory {
  if (type === "transfer") return "Transfers";
  if (type === "bridge") return "Swaps";
  if (type.startsWith("earn_") || type.startsWith("collateral_")) return "Earn";
  if (type === "borrow" || type === "repay" || type === "liquidation") return "Borrow";
  return "Other";
}

export function activityStatus(status: string) {
  if (status === "confirmed") return "Completed";
  if (status === "submitted") return "Pending";
  if (status === "reviewed" || status === "cooling") return "Awaiting approval";
  if (status === "cancelled") return "Cancelled";
  if (status === "failed" || status === "blocked") return "Failed";
  return status.replaceAll("_", " ");
}

export function activityEventLabel(type: string) {
  if (type === "policy_evaluated") return "Security review completed";
  if (type === "cooling_completed") return "Security delay completed";
  if (type === "intent_submitted") return "Submitted to network";
  if (type === "intent_confirmed") return "Confirmed on network";
  if (type === "intent_cancelled") return "Cancelled before submission";
  if (type === "intent_failed") return "Transaction failed";
  return type.replace(/^intent_/, "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

type ActivityExportRow = { createdAt: string; label: string; category: string; status: string; amount?: string; asset?: string; destination?: string; transactionHash?: string; chainId?: number; estimatedUsd?: number; source?: string; authority?: string };

function csvCell(value: string | number | undefined) {
  const raw = String(value ?? "");
  const safe = /^[=+\-@]/.test(raw) ? `'${raw}` : raw;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function activityCsv(rows: ActivityExportRow[]) {
  const header = ["Date", "Description", "Category", "Status", "Amount", "Asset", "Destination", "Transaction Hash", "Chain ID", "Source"];
  return [header.map(csvCell).join(","), ...rows.map((row) => [row.createdAt, row.label, row.category, row.status, row.amount, row.asset, row.destination, row.transactionHash, row.chainId, row.source].map(csvCell).join(","))].join("\n");
}

export function taxSupportCsv(rows: ActivityExportRow[]) {
  const header = ["Date", "Description", "Category", "Status", "Amount", "Asset", "Estimated USD", "Transaction Hash", "Chain ID", "Evidence Source", "Authority", "Tax Classification", "Cost Basis"];
  return [
    header.map(csvCell).join(","),
    ...rows.map((row) => [row.createdAt, row.label, row.category, row.status, row.amount, row.asset, row.estimatedUsd, row.transactionHash, row.chainId, row.source, row.authority, "Review required", "Unavailable"].map(csvCell).join(","))
  ].join("\n");
}
