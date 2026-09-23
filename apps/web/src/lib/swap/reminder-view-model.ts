import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { parseAssetId } from "@/lib/swap/assets";
import { assetNetwork } from "@/lib/swap/picker-model";

export type ReviewableOccurrence = { fromAssetId: string; toAssetId: string; amount: string; canReview: boolean; disabledReason: string | null };

export function reminderAssetLabel(id: string, symbol?: string): string {
  const asset = parseAssetId(id);
  if (!asset) return "Asset";
  const name = symbol || (asset.address === null
    ? SUPPORTED_CHAINS.find((chain) => chain.id === asset.chainId)?.nativeCurrency.symbol
    : `${asset.address.slice(0, 6)}…${asset.address.slice(-4)}`);
  return `${name ?? "Asset"} · ${assetNetwork(asset.chainId)}`;
}

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
