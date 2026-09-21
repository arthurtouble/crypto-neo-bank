export type SourceKind = "provider" | "chain" | "market-data";

export type SourceReference = {
  kind: SourceKind;
  name: string;
  externalId: string;
  observedAt: string;
  status: "confirmed" | "pending" | "stale" | "unavailable";
};

export type MoneyObservation = {
  asset: string;
  amount: string;
  decimals: number;
  source: SourceReference;
};

export type PositionObservation = MoneyObservation & {
  category: "liquid" | "productive" | "connected" | "borrowed";
  protocol?: string;
  chain?: string;
};

export interface PortfolioSourceAdapter {
  readonly name: string;
  listPositions(subjectReference: string): Promise<PositionObservation[]>;
}

export type ProviderCommandReceipt = {
  commandId: string;
  provider: string;
  providerObjectId: string;
  status: "accepted" | "requires_action" | "rejected";
  createdAt: string;
};

export interface FiatRailAdapter extends PortfolioSourceAdapter {
  createTransfer(input: {
    subjectReference: string;
    amount: string;
    asset: string;
    destinationReference: string;
    idempotencyKey: string;
  }): Promise<ProviderCommandReceipt>;
}

