import { describe, expect, it } from "vitest";
import { decodeFunctionData, encodeAbiParameters, encodeEventTopics, maxUint256, parseAbi, parseAbiItem, type PublicClient } from "viem";
import type { ChainObservation } from "@/lib/actions/chain";
import { buildEarn, earnInputSchema } from "@/lib/actions/earn";
import { ENTRY_POINT_V07, type Log } from "@/lib/actions/user-operation";
import { verifyAction, type VerifiableAction } from "@/lib/actions/verify";
import { AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { bundler, entryLog, handleOpsV07, kernelBatch } from "../support/bundles";

const wallet = "0x1111111111111111111111111111111111111111" as `0x${string}`;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as `0x${string}`;
const aToken = "0x4e65fe4dba92790696d040ac24aa414708f5c0ab";
const pool = AAVE_BASE_V3_MARKET.toLowerCase();
const hash = `0x${"a".repeat(64)}`;
const block = `0x${"b".repeat(64)}`;
const withdrawEvent = parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)");
const withdrawAbi = parseAbi(["function withdraw(address asset, uint256 amount, address to)"]);

/** A Base client that knows the USDC reserve's aToken and the account's balance of it. */
const chain = (balance: bigint) => ({
  readContract: async ({ functionName }: { functionName: string }) => functionName === "getReserveData" ? { aTokenAddress: aToken } : balance
}) as unknown as PublicClient;
const input = (direction: "deposit" | "withdraw", amount: string) =>
  earnInputSchema.parse({ kind: "earn", protocol: "aave", direction, asset: "USDC", amount });

function withdrawLog(to: `0x${string}`, amount: bigint): Log {
  const topics = encodeEventTopics({ abi: [withdrawEvent], eventName: "Withdraw", args: { reserve: usdc, user: wallet, to } }) as `0x${string}`[];
  return { address: pool, topics, data: encodeAbiParameters([{ type: "uint256" }], [amount]) } as Log;
}
const observed = (call: { to: string; data: string }, log: Log): ChainObservation => ({ status: "found", blockHash: block, canonicalBlockHash: block,
  confirmations: 5, finalizedBlockNumber: 100n,
  call: { chainId: 8453, from: bundler, to: ENTRY_POINT_V07, value: "0",
    data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: call.to as `0x${string}`, value: 0n, data: call.data as `0x${string}` }]) }]) },
  receipt: { status: "success", transactionHash: hash, blockHash: block, blockNumber: 100n,
    logs: [entryLog(ENTRY_POINT_V07, "before"), log, entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })] } });

describe("withdrawing everything from Aave", () => {
  it("asks the pool for the whole balance, with the balance read first as the least it must return", async () => {
    const built = await buildEarn(input("withdraw", "all"), wallet, chain(1_000_123n));
    expect(built.calls).toHaveLength(1);
    expect(built.calls[0].to).toBe(pool);
    const { functionName, args } = decodeFunctionData({ abi: withdrawAbi, data: built.calls[0].data });
    expect(functionName).toBe("withdraw");
    expect(args[1]).toBe(maxUint256);
    expect(args[2].toLowerCase()).toBe(wallet);
    expect(built.effects).toEqual([{ type: "aave_withdraw_all", asset: usdc, minimumRaw: "1000123" }]);
    expect(built.summary).toMatchObject({ protocol: "aave", direction: "withdraw", amount: "all", amountRaw: "1000123" });
    expect(built.countsTowardLimit).toBe(false);
  });

  it("refuses when there's nothing to withdraw, and never deposits 'all'", async () => {
    await expect(buildEarn(input("withdraw", "all"), wallet, chain(0n))).rejects.toMatchObject({ code: "insufficient_balance", message: "You have no USDC in Aave." });
    await expect(buildEarn(input("deposit", "all"), wallet, chain(5n))).rejects.toMatchObject({ code: "invalid_amount" });
  });

  it("confirms only the pool's own withdrawal to the account of at least the balance read", async () => {
    const built = await buildEarn(input("withdraw", "all"), wallet, chain(1_000_000n));
    const action: VerifiableAction = { chainId: 8453, walletAddress: wallet, calls: built.calls, transactionHash: hash, effects: built.effects };
    const verify = (log: Log) => verifyAction(action, { observe: async () => observed(built.calls[0], log) });
    // Interest adds to the balance between reading and executing.
    expect(await verify(withdrawLog(wallet, 1_000_042n))).toEqual({ status: "confirmed" });
    expect(await verify(withdrawLog(wallet, 1_000_000n))).toEqual({ status: "confirmed" });
    expect((await verify(withdrawLog(wallet, 999_999n))).status).toBe("failed");
    expect((await verify(withdrawLog("0x2222222222222222222222222222222222222222", 1_000_042n))).status).toBe("failed");
  });
});

describe("an exact Aave deposit or withdrawal", () => {
  /** A Base client where the account holds `wallet` USDC and `supplied` in Aave. */
  const funded = (walletRaw: bigint, supplied: bigint) => ({
    readContract: async ({ functionName, address }: { functionName: string; address: string }) =>
      functionName === "getReserveData" ? { aTokenAddress: aToken } : address.toLowerCase() === aToken ? supplied : walletRaw
  }) as unknown as PublicClient;

  it("refuses a deposit larger than the account holds, before anything is signed", async () => {
    await expect(buildEarn(input("deposit", "10"), wallet, funded(9_999_999n, 0n))).rejects.toMatchObject({ code: "insufficient_balance", message: "You don't have enough USDC." });
    expect((await buildEarn(input("deposit", "10"), wallet, funded(10_000_000n, 0n))).calls).toHaveLength(2);
  });

  it("refuses a withdrawal larger than the position", async () => {
    await expect(buildEarn(input("withdraw", "5"), wallet, funded(0n, 4_999_999n))).rejects.toMatchObject({ code: "insufficient_balance", message: "You don't have that much USDC in Aave." });
    expect((await buildEarn(input("withdraw", "5"), wallet, funded(0n, 5_000_000n))).calls).toHaveLength(1);
  });
});
