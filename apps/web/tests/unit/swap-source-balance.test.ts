import { describe, expect, it, vi } from "vitest";
import { encodeFunctionResult, erc20Abi, type PublicClient } from "viem";
import { observeSwapSourceBalance } from "@/lib/swap/source-balance";

const wallet = "0x000000000000000000000000000000000000dEaD";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const hash = `0x${"a".repeat(64)}` as const;
const block = { number: 42n, hash, timestamp: 1_000_000n };

function rpc(balance = 1_000_000n) {
  return {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => block),
    getBalance: vi.fn(async () => balance),
    call: vi.fn(async () => ({ data: encodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", result: balance }) }))
  };
}

describe("independent Swap source balance", () => {
  it("proves the selected token balance at a canonical, fresh source-chain block", async () => {
    const client = rpc();
    const evidence = await observeSwapSourceBalance(client as unknown as PublicClient, {
      wallet, assetId: `8453:${usdc.toLowerCase()}`, amountRaw: "500000", nowMs: 1_000_002_000, maxAgeMs: 30_000
    });
    expect(evidence).toMatchObject({ chainId: 8453, blockHash: hash, balanceRaw: "1000000", amountRaw: "500000" });
    expect(client.call).toHaveBeenCalledWith(expect.objectContaining({ to: usdc, blockHash: hash, requireCanonical: true }));
  });

  it("rejects a source balance below the reviewed amount", async () => {
    await expect(observeSwapSourceBalance(rpc(499_999n) as unknown as PublicClient, {
      wallet, assetId: `8453:${usdc.toLowerCase()}`, amountRaw: "500000", nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/insufficient/i);
  });

  it("rejects a wrong chain, stale block, and changed canonical block", async () => {
    const wrong = rpc(); wrong.getChainId.mockResolvedValue(1);
    await expect(observeSwapSourceBalance(wrong as unknown as PublicClient, {
      wallet, assetId: "8453:native", amountRaw: "1", nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/chain/i);
    await expect(observeSwapSourceBalance(rpc() as unknown as PublicClient, {
      wallet, assetId: "8453:native", amountRaw: "1", nowMs: 1_200_000_000, maxAgeMs: 30_000
    })).rejects.toThrow(/stale/i);
    const changed = rpc(); changed.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, hash: `0x${"b".repeat(64)}` as const });
    await expect(observeSwapSourceBalance(changed as unknown as PublicClient, {
      wallet, assetId: "8453:native", amountRaw: "1", nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/canonical/i);
  });
});
