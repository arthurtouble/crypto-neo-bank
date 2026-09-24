import { describe, expect, it } from "vitest";
import { base } from "viem/chains";
import { createPublicClient, http } from "viem";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { readAaveBaseRiskSnapshot } from "@/lib/defi/aave-risk-snapshot";
import { readCurrentAaveLegs } from "@/lib/portfolio/aave-source";
import { readHistoricalAaveLegs } from "@/lib/portfolio/aave-history-positions";

// Explicitly opt in to read-only public mainnet calls. No wallet or signature is used.
describe.skipIf(process.env.AUREL_LIVE_READONLY !== "1")("Aave Base read-only snapshot", () => {
  it("reads one canonical block for a non-customer observation address", async () => {
    const client = createPublicClient({
      chain: base,
      transport: http(process.env.AUREL_BASE_READ_RPC_URL || "https://base-rpc.publicnode.com", {
        retryCount: 0,
        timeout: 12_000,
      }),
    });
    // Viem's Base-specific PublicClient return type is narrower than its default generic.
    const snapshot = await readAaveBaseRiskSnapshot(client as unknown as Parameters<typeof readAaveBaseRiskSnapshot>[0], {
      user: "0x000000000000000000000000000000000000dEaD",
      asset: AAVE_BASE_ASSETS.USDC,
      action: "supply",
      amountRaw: 1n,
      minHealthFactorWad: 1_200_000_000_000_000_000n,
      nowMs: Date.now(),
      maxAgeMs: 120_000,
    });
    expect(snapshot.snapshot.complete).toBe(true);
    expect(snapshot.snapshot.blockNumber).toBeGreaterThan(0n);
    expect(snapshot.snapshot.blockHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(snapshot.reserve.priceBase).toBeGreaterThan(0n);
  }, 90_000);

  it("reads every Base reserve for a non-customer account at one canonical block", async () => {
    const result = await readCurrentAaveLegs("8453:0x000000000000000000000000000000000000dead");
    expect(result.status, result.reason ?? "unknown").toBe("complete");
    expect(new Set(result.legs.map((leg) => leg.observedAt)).size).toBeLessThanOrEqual(1);
    expect(result.legs.every((leg) => BigInt(leg.rawUnits) !== 0n && leg.sourceId === "aave:v3:8453")).toBe(true);
  }, 90_000);

  it("reads a completed UTC day's historical reserves from archive state", async () => {
    const client = createPublicClient({ chain: base, transport: http(
      process.env.AUREL_BASE_ARCHIVE_RPC_URL || "https://mainnet.base.org",
      { retryCount: 0, timeout: 12_000 }
    ) });
    const day = process.env.AUREL_HISTORICAL_DAY || new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const result = await readHistoricalAaveLegs("8453:0x000000000000000000000000000000000000dead", day,
      { client: client as never });
    expect(result.status, result.reason ?? "unknown").toBe("complete");
    expect(result.blockHash).toMatch(/^0x[0-9a-f]{64}$/i);
    expect(result.blockNumber).toMatch(/^[1-9]\d*$/);
    expect(result.legs.every((leg) => BigInt(leg.rawUnits) !== 0n)).toBe(true);
  }, 180_000);
});
