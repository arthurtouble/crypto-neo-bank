import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionData, encodeFunctionResult, erc20Abi, parseAbi, type PublicClient } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { observeBaseDirectTransferFeeBudget } from "@/lib/transactions/direct-transfer-fee-budget";

const from = "0x000000000000000000000000000000000000dEaD";
const recipient = "0x0000000000000000000000000000000000000001";
const blockHash = `0x${"a".repeat(64)}` as const;
const oracle = "0x420000000000000000000000000000000000000F";
const oracleAbi = parseAbi(["function getL1FeeUpperBound(uint256) view returns (uint256)"]);
const proof = { chainId: 8453 as const, blockNumber: 42n, blockHash, observedAtMs: 1_000_000_000,
  simulationSucceeded: true as const, assetBalanceRaw: "1000", assetBalanceObserved: true as const,
  balanceAndGasProven: false as const, signingReady: false as const };

function rpc(ethBalance = 1_000_000_000n) {
  return {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => ({ number: 42n, hash: blockHash, timestamp: 1_000_000n,
      baseFeePerGas: 10n, gasLimit: 30_000_000n })),
    getBalance: vi.fn(async () => ethBalance),
    estimateGas: vi.fn(async () => 21_000n),
    estimateFeesPerGas: vi.fn(async () => ({ maxFeePerGas: 20n, maxPriorityFeePerGas: 2n })),
    call: vi.fn(async ({ to, data }: { to: string; data: `0x${string}` }) => {
      if (to.toLowerCase() !== oracle.toLowerCase()) {
        if (data === "0x") return { data: "0x" };
        const decodedToken = decodeFunctionData({ abi: erc20Abi, data });
        if (decodedToken.functionName === "transfer") return { data: `0x${"0".repeat(63)}1` };
        if (decodedToken.functionName === "balanceOf") return { data: encodeFunctionResult({
          abi: erc20Abi, functionName: "balanceOf", result: 1000n }) };
        throw new Error("unexpected token call");
      }
      const decoded = decodeFunctionData({ abi: oracleAbi, data });
      if (decoded.functionName !== "getL1FeeUpperBound") throw new Error("unexpected selector");
      return { data: encodeFunctionResult({ abi: oracleAbi, functionName: "getL1FeeUpperBound", result: 100n }) };
    })
  };
}

async function native() {
  return normalizePreparedCall({ chainId: 8453, from, to: recipient, value: "1000", data: "0x" });
}

describe("disconnected Base transfer fee budget", () => {
  it("observes L2 and L1 fee reserve at the canonical simulation block without enabling signing", async () => {
    const call = await native();
    const client = rpc();
    const result = await observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation: { ...proof, fingerprint: call.fingerprint }, amountRaw: "1000", nativeAsset: true,
      nowMs: 1_000_002_000, maxAgeMs: 30_000
    });
    expect(result).toMatchObject({ blockHash, gasEstimateRaw: "21000", gasLimitRaw: "27250",
      maxFeePerGasRaw: "20", l1FeeUpperBoundRaw: "100", requiredEthRaw: "546100",
      ethBalanceRaw: "1000000000", estimatedReserveSufficient: true, signingReady: false });
    expect(client.estimateGas).toHaveBeenCalledWith({ account: from, to: recipient,
      value: 1_000n, data: "0x", blockNumber: 42n });
    expect(client.getBalance).toHaveBeenCalledWith({ address: from, blockHash, requireCanonical: true });
    expect(client.call).toHaveBeenCalledWith({ to: oracle, data: expect.any(String),
      blockHash, requireCanonical: true });
  });

  it("rejects insufficient ETH reserve rather than treating an exact transfer balance as spendable", async () => {
    const call = await native();
    await expect(observeBaseDirectTransferFeeBudget(rpc(546_099n) as unknown as PublicClient, {
      call, simulation: { ...proof, fingerprint: call.fingerprint }, amountRaw: "1000", nativeAsset: true,
      nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/fee|balance/i);
  });

  it("rejects a changed simulation fingerprint before querying fees", async () => {
    const call = await native();
    const client = rpc();
    await expect(observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation: { ...proof, fingerprint: `0x${"b".repeat(64)}` }, amountRaw: "1000", nativeAsset: true,
      nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/identity/i);
    expect(client.estimateGas).not.toHaveBeenCalled();
  });

  it("rejects a canonical block change after observing fees", async () => {
    const call = await native();
    const client = rpc();
    client.getBlock.mockResolvedValueOnce({ number: 42n, hash: blockHash, timestamp: 1_000_000n,
      baseFeePerGas: 10n, gasLimit: 30_000_000n });
    client.getBlock.mockResolvedValueOnce({ number: 42n, hash: `0x${"b".repeat(64)}` as const,
      timestamp: 1_000_000n, baseFeePerGas: 10n, gasLimit: 30_000_000n });
    await expect(observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation: { ...proof, fingerprint: call.fingerprint }, amountRaw: "1000", nativeAsset: true,
      nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/canonical/i);
  });

  it("reserves ETH for token gas, but rejects an amount that differs from token calldata", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 1000n] });
    const call = await normalizePreparedCall({ chainId: 8453, from, to: recipient, value: "0", data });
    const client = rpc(545_100n);
    const simulation = { ...proof, fingerprint: call.fingerprint };
    const observed = await observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation, amountRaw: "1000", nativeAsset: false, nowMs: 1_000_002_000, maxAgeMs: 30_000
    });
    expect(observed.requiredEthRaw).toBe("545100");
    await expect(observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation, amountRaw: "999", nativeAsset: false, nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/amount|calldata/i);
  });

  it("rejects a forged token balance proof when the canonical chain balance is lower", async () => {
    const data = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 1000n] });
    const call = await normalizePreparedCall({ chainId: 8453, from, to: recipient, value: "0", data });
    const client = rpc();
    client.call.mockImplementation(async ({ to, data }: { to: string; data: `0x${string}` }) => {
      if (to.toLowerCase() === oracle.toLowerCase()) return { data: encodeFunctionResult({
        abi: oracleAbi, functionName: "getL1FeeUpperBound", result: 100n }) };
      const decoded = decodeFunctionData({ abi: erc20Abi, data });
      if (decoded.functionName === "balanceOf") return { data: encodeFunctionResult({
        abi: erc20Abi, functionName: "balanceOf", result: 999n }) };
      return { data: `0x${"0".repeat(63)}1` };
    });
    await expect(observeBaseDirectTransferFeeBudget(client as unknown as PublicClient, {
      call, simulation: { ...proof, fingerprint: call.fingerprint }, amountRaw: "1000", nativeAsset: false,
      nowMs: 1_000_002_000, maxAgeMs: 30_000
    })).rejects.toThrow(/balance|simulation/i);
  });
});
