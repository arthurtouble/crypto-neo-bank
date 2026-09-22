import type { AssetId } from "@/lib/swap/assets";

export type AccountId = `${number}:0x${string}`;
export type EventKind = "contribution" | "withdrawal" | "internal_transfer" | "swap" | "reward" | "fee" | "wrap" | "unwrap" | "supply" | "redeem" | "borrow" | "repay" | "liquidation" | "unknown";
export type Completeness = "complete" | "partial" | "unavailable" | "unfinalized";
export type HistoricalEvent = {
  sourceId: string;
  sourceName: string;
  sourceEventId: string;
  ingestionVersion: number;
  accountId: AccountId;
  assetId: AssetId;
  rawDelta: string;
  decimals: number;
  kind: EventKind;
  occurredAt: string;
  chainId: number | null;
  blockNumber: string | null;
  blockHash: string | null;
  txHash: string | null;
  logIndex: number | null;
  finality: "finalized" | "pending" | "reorged";
  completeness: Completeness;
  groupId: string | null;
  counterpartyAccountId: AccountId | null;
  evidenceJson: string;
};
export type HistoryPage = {
  events: HistoricalEvent[];
  nextCursor: string | null;
  coveredThrough: string;
  complete: boolean;
  sourceId: string;
};
export interface HistoricalEventSource {
  readonly sourceId: string;
  page(input: { accountId: AccountId; cursor: string | null; from: string; through: string; limit: number }): Promise<HistoryPage>;
}
export type PriceObservation = {
  assetId: AssetId;
  day: string;
  usd: string;
  sourceId: string;
  observedAt: string;
  methodology: string;
  version: number;
};
export type DayCoverage = {
  day: string;
  accountId: AccountId;
  sourceId: string;
  eventStatus: Completeness;
  priceStatus: Completeness;
  reason: string | null;
};
export type HistoryPoint = {
  day: string;
  netValueUsd: string | null;
  twrIndex: string | null;
  status: Completeness;
  reasons: string[];
};
export type PortfolioHistory = {
  calculationVersion: number;
  points: HistoryPoint[];
  currentAave: { suppliedUsd: string | null; debtUsd: string | null; status: Completeness };
  externalWallets: AccountId[];
  coverage: DayCoverage[];
  observedAt: string;
};
