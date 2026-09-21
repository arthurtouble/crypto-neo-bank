import type { FiatRailAdapter, PositionObservation, ProviderCommandReceipt } from "./contracts";

const observedAt = "2026-09-21T09:42:00.000Z";

export class DemoBridgeAdapter implements FiatRailAdapter {
  readonly name = "bridge-simulator";

  async listPositions(subjectReference: string): Promise<PositionObservation[]> {
    return [
      {
        asset: "USD",
        amount: "28450.18",
        decimals: 2,
        category: "liquid",
        source: {
          kind: "provider",
          name: this.name,
          externalId: `virtual-account:${subjectReference}`,
          observedAt,
          status: "confirmed",
        },
      },
    ];
  }

  async createTransfer(input: {
    subjectReference: string;
    amount: string;
    asset: string;
    destinationReference: string;
    idempotencyKey: string;
  }): Promise<ProviderCommandReceipt> {
    return {
      commandId: input.idempotencyKey,
      provider: this.name,
      providerObjectId: `demo-transfer:${input.subjectReference}:${input.idempotencyKey}`,
      status: "requires_action",
      createdAt: observedAt,
    };
  }
}

export class DemoOnchainAdapter {
  readonly name = "base-indexer-simulator";

  async listPositions(subjectReference: string): Promise<PositionObservation[]> {
    return [
      {
        asset: "USDC",
        amount: "112840.24",
        decimals: 6,
        category: "productive",
        protocol: "Aave V3",
        chain: "Base",
        source: {
          kind: "chain",
          name: this.name,
          externalId: `position:${subjectReference}:aave-v3-base`,
          observedAt,
          status: "confirmed",
        },
      },
      {
        asset: "USD",
        amount: "43000.00",
        decimals: 2,
        category: "connected",
        chain: "Ethereum",
        source: {
          kind: "chain",
          name: this.name,
          externalId: `wallet:${subjectReference}:external`,
          observedAt,
          status: "confirmed",
        },
      },
    ];
  }
}

