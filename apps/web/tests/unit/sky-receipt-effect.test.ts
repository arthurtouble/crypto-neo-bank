import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, parseAbiItem, parseUnits } from "viem";
import { buildSkyCall, SKY_SUSDS, SKY_USDC, SKY_USDC_ACTIONS } from "@/lib/defi/sky-call-policy";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import type { ChainObservation } from "@/lib/transactions/chain-observation";

const wallet = "0x1111111111111111111111111111111111111111";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const amountRaw = parseUnits("100", 6);
const deposit = parseAbiItem("event Deposit(address indexed sender, address indexed owner, uint256 assets, uint256 shares)");
const withdraw = parseAbiItem("event Withdraw(address indexed sender, address indexed receiver, address indexed owner, uint256 assets, uint256 shares)");
const transfer = (from: string, to: string, value: bigint) => ({ address: SKY_USDC,
  topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: from as `0x${string}`, to: to as `0x${string}` } }).map(String),
  data: encodeAbiParameters([{ type: "uint256" }], [value]) });
const vaultDeposit = (owner = wallet, assets = parseUnits("100", 18)) => ({ address: SKY_SUSDS,
  topics: encodeEventTopics({ abi: [deposit], eventName: "Deposit", args: { sender: SKY_USDC_ACTIONS, owner: owner as `0x${string}` } }).map(String),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [assets, parseUnits("90", 18)]) });
const vaultWithdraw = (owner = wallet) => ({ address: SKY_SUSDS,
  topics: encodeEventTopics({ abi: [withdraw], eventName: "Withdraw", args: { sender: SKY_USDC_ACTIONS,
    receiver: SKY_USDC_ACTIONS, owner: owner as `0x${string}` } }).map(String),
  data: encodeAbiParameters([{ type: "uint256" }, { type: "uint256" }], [parseUnits("100", 18), parseUnits("90", 18)]) });

async function fixture(action: "deposit" | "withdraw") {
  const call = await normalizePreparedCall(buildSkyCall({ action, wallet, amountRaw }));
  const observed: ChainObservation = { status: "found", call, blockHash, canonicalBlockHash: blockHash,
    confirmations: 12, finalizedBlockNumber: 100n, receipt: { status: "success", transactionHash: hash,
      blockHash, blockNumber: 100n, logs: action === "deposit"
        ? [transfer(wallet, SKY_USDC_ACTIONS, amountRaw), vaultDeposit()]
        : [vaultWithdraw(), transfer(SKY_USDC_ACTIONS, wallet, amountRaw)] } };
  return { prepared: { chainId: 1, walletAddress: wallet, targetAddress: call.to, nativeValue: "0",
    calldataHash: call.dataHash, semanticAction: action === "deposit" ? "sky_deposit" : "sky_withdraw",
    expectedEffect: { type: action === "deposit" ? "sky_deposit" : "sky_withdraw", amountRaw: amountRaw.toString() },
    reportedHash: hash, observedBlockHash: null }, observed };
}

describe("Sky receipt evidence", () => {
  it("confirms only a finalized deposit with exact USDC debit and customer-owned sUSDS", async () => {
    const input = await fixture("deposit");
    expect(await verifyExpectedEffect(input.prepared, input.observed)).toEqual({ status: "confirmed" });
    if (input.observed.status !== "found") return;
    input.observed.receipt!.logs = [transfer(wallet, SKY_USDC_ACTIONS, amountRaw), vaultDeposit(wallet, parseUnits("98", 18))];
    expect((await verifyExpectedEffect(input.prepared, input.observed)).status).toBe("inconsistent");
    input.observed.receipt!.logs = [transfer(wallet, SKY_USDC_ACTIONS, amountRaw), vaultDeposit("0x2222222222222222222222222222222222222222")];
    expect((await verifyExpectedEffect(input.prepared, input.observed)).status).toBe("inconsistent");
  });

  it("confirms only exact USDC returned to the owner on withdrawal", async () => {
    const input = await fixture("withdraw");
    expect(await verifyExpectedEffect(input.prepared, input.observed)).toEqual({ status: "confirmed" });
    if (input.observed.status !== "found") return;
    input.observed.receipt!.logs = [vaultWithdraw(), transfer(SKY_USDC_ACTIONS, wallet, amountRaw - 1n)];
    expect((await verifyExpectedEffect(input.prepared, input.observed)).status).toBe("inconsistent");
  });

  it("keeps pending or mismatched chain evidence unconfirmed", async () => {
    const input = await fixture("deposit");
    if (input.observed.status !== "found") return;
    input.observed.finalizedBlockNumber = 99n;
    expect((await verifyExpectedEffect(input.prepared, input.observed)).status).toBe("pending");
    input.observed.finalizedBlockNumber = 100n;
    input.observed.call = { ...input.observed.call, to: SKY_USDC };
    expect((await verifyExpectedEffect(input.prepared, input.observed)).status).toBe("inconsistent");
  });
});
