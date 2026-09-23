import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, erc20Abi, parseAbi, type PublicClient } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { observeSwapExecutionBudget } from "@/lib/swap/simulation";

const wallet = "0x000000000000000000000000000000000000dEaD";
const target = "0x0000000000000000000000000000000000000001";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const oracle = "0x420000000000000000000000000000000000000F";
const oracleAbi = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)"]);
const hash = `0x${"a".repeat(64)}` as const;
const nowMs = 1_000_002_000;
const block = { number: 42n, hash, timestamp: 1_000_000n, baseFeePerGas: 10n, gasLimit: 30_000_000n };

async function fixture(native = false) {
  const sourceCall = { chainId: 8453, from: wallet, to: target,
    value: native ? "1000" : "0", data: "0x1234" };
  const call = await normalizePreparedCall(sourceCall);
  const assetId = native ? "8453:native" : `8453:${token.toLowerCase()}`;
  return { call, plan: { sourceCall, fromChainId: 8453, fromAssetId: assetId, fromAmountRaw: "1000" },
    sourceBalance: { chainId: 8453, wallet, assetId, amountRaw: "1000", balanceRaw: "2000",
      blockNumber: 42n, blockHash: hash, observedAtMs: 1_000_000_000 } };
}

function rpc(nativeBalance = 1_000_000n, assetBalance = 2_000n) {
  return {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => block),
    getBalance: vi.fn(async () => nativeBalance),
    estimateGas: vi.fn(async () => 21_000n),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 20n, maxPriorityFeePerGas: 2n })),
    call: vi.fn(async ({ to, data }: { to: string; data: `0x${string}` }) => {
      if (to.toLowerCase() === oracle.toLowerCase()) return { data: encodeFunctionResult({
        abi: oracleAbi, functionName: "getL1FeeUpperBound", result: 100n }) };
      if (data.startsWith("0x70a08231")) return { data: encodeFunctionResult({
        abi: erc20Abi, functionName: "balanceOf", result: assetBalance }) };
      return { data: "0x" as const };
    })
  };
}

describe("read-only Swap execution budget", () => {
  it("simulates the exact server-held call and reserves Base L2 plus L1 fees", async () => {
    const input = await fixture();
    const client = rpc();
    const evidence = await observeSwapExecutionBudget(client as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 });
    expect(evidence).toMatchObject({ chainId: 8453, blockNumber: 42n, blockHash: hash,
      fingerprint: input.call.fingerprint, gasEstimateRaw: "21000", gasLimitRaw: "27250",
      l1FeeUpperBoundRaw: "100", requiredNativeRaw: "545100", sourceBalanceRaw: "2000",
      nativeBalanceRaw: "1000000", simulationSucceeded: true, estimatedReserveSufficient: true,
      signingReady: false });
    expect(client.call).toHaveBeenCalledWith({ account: wallet, to: target, value: 0n,
      data: "0x1234", blockHash: hash, requireCanonical: true });
    expect(client.estimateGas).toHaveBeenCalledWith({ account: wallet, to: target,
      value: 0n, data: "0x1234", blockNumber: 42n });
  });

  it("rejects changed calldata, target, amount, wallet or forged balance evidence before simulation", async () => {
    const input = await fixture();
    const client = rpc();
    for (const changed of [
      { call: { ...input.call, data: "0x5678" as const } },
      { call: { ...input.call, to: wallet as `0x${string}` } },
      { plan: { ...input.plan, fromAmountRaw: "999" } },
      { sourceBalance: { ...input.sourceBalance, wallet: target } },
      { sourceBalance: { ...input.sourceBalance, balanceRaw: "999" } }
    ]) await expect(observeSwapExecutionBudget(client as unknown as PublicClient,
      { ...input, ...changed, nowMs, maxAgeMs: 30_000 })).rejects.toThrow();
    expect(client.call).not.toHaveBeenCalled();
  });

  it("rejects stale balance evidence, a wrong RPC chain, and a reorg", async () => {
    const input = await fixture();
    await expect(observeSwapExecutionBudget(rpc() as unknown as PublicClient,
      { ...input, sourceBalance: { ...input.sourceBalance, observedAtMs: 900_000_000 },
        nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/stale/i);
    const wrong = rpc(); wrong.getChainId.mockResolvedValue(1);
    await expect(observeSwapExecutionBudget(wrong as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/chain/i);
    const changed = rpc(); changed.getBlock.mockResolvedValueOnce(block)
      .mockResolvedValueOnce({ ...block, hash: `0x${"b".repeat(64)}` as const });
    await expect(observeSwapExecutionBudget(changed as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/canonical/i);
  });

  it("rejects insufficient independently rechecked token balance or native gas reserve", async () => {
    const input = await fixture();
    await expect(observeSwapExecutionBudget(rpc(1_000_000n, 999n) as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/source.*balance/i);
    await expect(observeSwapExecutionBudget(rpc(545_099n) as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/native.*balance|reserve/i);
  });

  it("includes native source value in the reserve", async () => {
    const input = await fixture(true);
    const client = rpc(546_100n);
    const evidence = await observeSwapExecutionBudget(client as unknown as PublicClient,
      { ...input, sourceBalance: { ...input.sourceBalance, balanceRaw: "546100" },
        nowMs, maxAgeMs: 30_000 });
    expect(evidence.requiredNativeRaw).toBe("546100");
    expect(client.call).toHaveBeenCalledWith({ account: wallet, to: target,
      value: 1000n, data: "0x1234", blockHash: hash, requireCanonical: true });
  });

  it("fails closed if Base L1 fee upper bound or simulation is unavailable", async () => {
    const input = await fixture();
    const noOracle = rpc();
    noOracle.call.mockImplementation(async ({ to, data }: { to: string; data: string }) => {
      if (to.toLowerCase() === oracle.toLowerCase()) throw new Error("oracle unavailable");
      if (data.startsWith("0x70a08231")) return { data: encodeFunctionResult({
        abi: erc20Abi, functionName: "balanceOf", result: 2000n }) };
      return { data: "0x" as const };
    });
    await expect(observeSwapExecutionBudget(noOracle as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/oracle unavailable/i);
    const reverted = rpc();
    reverted.call.mockRejectedValueOnce(new Error("execution reverted"));
    await expect(observeSwapExecutionBudget(reverted as unknown as PublicClient,
      { ...input, nowMs, maxAgeMs: 30_000 })).rejects.toThrow(/reverted/i);
  });
});
