import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, erc20Abi, type PublicClient } from "viem";
import { observeNextSwapApproval } from "@/lib/swap/approval-steps";

const wallet = "0x000000000000000000000000000000000000dEaD";
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const spender = "0x0000000000000000000000000000000000001234";
const hash = `0x${"a".repeat(64)}` as const;
const block = { number: 42n, hash, timestamp: 1_000_000n };
const plan = {
  fromAssetId: `8453:${token.toLowerCase()}`,
  fromChainId: 8453,
  fromAmountRaw: "500000",
  approvalSpender: spender,
  sourceCall: { chainId: 8453, from: wallet }
};

function rpc(allowance: bigint, simulation = true) {
  return {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => block),
    call: vi.fn(async ({ data }: { data: `0x${string}` }) => {
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      if (decoded.functionName === "allowance") return {
        data: encodeFunctionResult({ abi: erc20Abi, functionName: "allowance", result: allowance })
      };
      if (decoded.functionName === "approve") return {
        data: encodeFunctionResult({ abi: erc20Abi, functionName: "approve", result: simulation })
      };
      throw new Error("Unexpected RPC call");
    })
  };
}

const request = { plan, wallet, reviewedSpender: spender, nowMs: 1_000_002_000, maxAgeMs: 30_000 };

describe("swap approval prerequisite", () => {
  it("returns no approval when the reviewed spender already has enough allowance", async () => {
    const client = rpc(500_000n);
    const result = await observeNextSwapApproval(client as unknown as PublicClient, request);
    expect(result).toMatchObject({ kind: "sufficient", allowanceRaw: "500000", blockHash: hash });
    expect(client.call).toHaveBeenCalledTimes(1);
  });

  it("simulates an exact-amount approval when allowance is zero", async () => {
    const client = rpc(0n);
    const result = await observeNextSwapApproval(client as unknown as PublicClient, request);
    expect(result).toMatchObject({ kind: "approve", allowanceRaw: "0", blockHash: hash,
      step: { chainId: 8453, from: wallet, to: token, value: "0", amountRaw: "500000", spender } });
    if (result.kind !== "approve") throw new Error("Expected approve step");
    const call = decodeFunctionData({ abi: erc20Abi, data: result.step.data });
    expect(call.functionName).toBe("approve");
    expect(call.args).toEqual([spender, 500_000n]);
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("simulates zero-reset first when an insufficient nonzero allowance exists", async () => {
    const client = rpc(10n);
    const result = await observeNextSwapApproval(client as unknown as PublicClient, request);
    expect(result).toMatchObject({ kind: "reset_required", next: "recheck_after_reset",
      step: { amountRaw: "0", spender, value: "0" } });
    if (result.kind !== "reset_required") throw new Error("Expected reset step");
    const call = decodeFunctionData({ abi: erc20Abi, data: result.step.data });
    expect(call.args).toEqual([spender, 0n]);
    expect(client.call).toHaveBeenCalledTimes(2);
  });

  it("refuses mismatched plan identity, unreviewed spender and unreviewed asset before RPC", async () => {
    const client = rpc(0n);
    const invalid = [
      { ...request, wallet: "0x0000000000000000000000000000000000000001" },
      { ...request, reviewedSpender: "0x0000000000000000000000000000000000000001" },
      { ...request, plan: { ...plan, fromAmountRaw: "0" } },
      { ...request, plan: { ...plan, fromChainId: 1 } },
      { ...request, plan: { ...plan, fromAssetId: "8453:0x0000000000000000000000000000000000000001" } }
    ];
    for (const candidate of invalid) {
      await expect(observeNextSwapApproval(client as unknown as PublicClient, candidate)).rejects.toThrow();
    }
    expect(client.getChainId).not.toHaveBeenCalled();
  });

  it("rejects wrong chain, stale or changing canonical block, and failed approval simulation", async () => {
    const wrong = rpc(0n); wrong.getChainId.mockResolvedValue(1);
    await expect(observeNextSwapApproval(wrong as unknown as PublicClient, request)).rejects.toThrow(/chain/i);
    await expect(observeNextSwapApproval(rpc(0n) as unknown as PublicClient, {
      ...request, nowMs: 1_100_000_000
    })).rejects.toThrow(/stale/i);
    const changed = rpc(0n);
    changed.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, hash: `0x${"b".repeat(64)}` as const });
    await expect(observeNextSwapApproval(changed as unknown as PublicClient, request)).rejects.toThrow(/canonical/i);
    await expect(observeNextSwapApproval(rpc(0n, false) as unknown as PublicClient, request)).rejects.toThrow(/simulation/i);
  });
});
