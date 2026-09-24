import { describe, expect, it, vi } from "vitest";
import { buildAaveBaseCall } from "@/lib/defi/aave-call-policy";
import { simulateAaveBaseCall } from "@/lib/defi/aave-simulation";

const wallet = "0x2222222222222222222222222222222222222222";
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const blockHash = `0x${"a".repeat(64)}` as const;
const call = buildAaveBaseCall({ action: "supply", wallet, asset, amountRaw: 1_000_000n });
const nowMs = 1_800_000_000_000;
const reviewed = { action: "supply" as const, wallet, asset, amountRaw: 1_000_000n, call };

function client(result: string = "0x") {
  return {
    request: vi.fn().mockResolvedValue(result),
    getBlock: vi.fn().mockResolvedValue({ hash: blockHash })
  };
}

describe("Aave exact-call simulation", () => {
  it("simulates the exact reviewed call against its canonical block", async () => {
    const rpc = client();
    const evidence = await simulateAaveBaseCall(rpc as never, { ...reviewed, blockNumber: 12_345n, blockHash,
      observedAtMs: nowMs - 10_000, now: () => nowMs });
    expect(rpc.request).toHaveBeenCalledWith({ method: "eth_call", params: [
      { from: wallet, to: call.to, data: call.data, value: "0x0" },
      { blockHash, requireCanonical: true }
    ] });
    expect(rpc.getBlock).toHaveBeenCalledWith({ blockNumber: 12_345n });
    expect(evidence).toEqual({ blockNumber: "12345", blockHash, observedAtMs: nowMs - 10_000 });
  });

  it("rejects stale evidence before calling the RPC", async () => {
    const rpc = client();
    await expect(simulateAaveBaseCall(rpc as never, { ...reviewed, blockNumber: 1n, blockHash,
      observedAtMs: nowMs - 31_000, now: () => nowMs })).rejects.toThrow(/stale/i);
    expect(rpc.request).not.toHaveBeenCalled();
  });

  it("rejects a reverted call and a changed block", async () => {
    const reverted = client();
    reverted.request.mockRejectedValue(new Error("execution reverted"));
    await expect(simulateAaveBaseCall(reverted as never, { ...reviewed, blockNumber: 1n, blockHash,
      observedAtMs: nowMs, now: () => nowMs })).rejects.toThrow(/simulation/i);
    const reorged = client();
    reorged.getBlock.mockResolvedValue({ hash: `0x${"b".repeat(64)}` });
    await expect(simulateAaveBaseCall(reorged as never, { ...reviewed, blockNumber: 1n, blockHash,
      observedAtMs: nowMs, now: () => nowMs })).rejects.toThrow(/canonical/i);
  });
});
