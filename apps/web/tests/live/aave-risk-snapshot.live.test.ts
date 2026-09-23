import { describe, expect, it } from "vitest";
import { base } from "viem/chains";
import { createPublicClient, http } from "viem";
import { AAVE_BASE_ASSETS } from "@/lib/defi/aave";
import { readAaveBaseRiskSnapshot } from "@/lib/defi/aave-risk-snapshot";

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
});
