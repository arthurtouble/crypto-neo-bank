import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, padHex, parseAbiItem } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { verifyCrossChainSourceEffect } from "@/lib/swap/cross-source-effect";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const router = "0x3333333333333333333333333333333333333333";
const pool = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const arbUsdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const word = (address: string) => padHex(address as `0x${string}`, { size: 32 });
const event = parseAbiItem("event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)");

function deposit(overrides: { address?: string; inputAmount?: bigint; outputAmount?: bigint; destinationChainId?: bigint;
  depositor?: string; recipient?: string; inputToken?: string; outputToken?: string; message?: `0x${string}` } = {}) {
  const args = { inputToken: word(overrides.inputToken ?? baseUsdc), outputToken: word(overrides.outputToken ?? arbUsdc),
    inputAmount: overrides.inputAmount ?? 997_500n, outputAmount: overrides.outputAmount ?? 990_000n,
    destinationChainId: overrides.destinationChainId ?? 42161n, depositId: 7n, quoteTimestamp: 1,
    fillDeadline: 2, exclusivityDeadline: 0, depositor: word(overrides.depositor ?? wallet),
    recipient: word(overrides.recipient ?? recipient), exclusiveRelayer: word("0x0000000000000000000000000000000000000000"),
    message: overrides.message ?? "0x" };
  const nonIndexed = event.inputs.filter((input) => !("indexed" in input && input.indexed));
  return { address: overrides.address ?? pool,
    topics: encodeEventTopics({ abi: [event], eventName: "FundsDeposited", args: {
      destinationChainId: args.destinationChainId, depositId: args.depositId, depositor: args.depositor } }).map(String),
    data: encodeAbiParameters(nonIndexed, nonIndexed.map((input) => args[input.name as keyof typeof args])) };
}

function transfer(amount: bigint, from = wallet) {
  return { address: baseUsdc,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: {
      from: from as `0x${string}`, to: pool } }).map(String),
    data: `0x${amount.toString(16).padStart(64, "0")}` };
}

async function fixture() {
  const call = await normalizePreparedCall({ chainId: 8453, from: wallet, to: router, value: "0", data: "0x1234" });
  const observed: ChainObservation = { status: "found", call, blockHash,
    receipt: { status: "success", transactionHash: hash, blockHash, blockNumber: 100n,
      logs: [transfer(1_000_000n), deposit()] }, canonicalBlockHash: blockHash,
    confirmations: 5, finalizedBlockNumber: 100n };
  return { call, observed, expected: { wallet, recipient, sourceChainId: 8453, destinationChainId: 42161,
    sourceAmountRaw: "1000000", bridgeAmountRaw: "997500", bridgeOutputRaw: "990000",
    quoteTimestamp: 1, fillDeadline: 2,
    minimumOutputRaw: "980000", reportedHash: hash } };
}

describe("Across source transaction evidence", () => {
  it("confirms only the finalized source deposit", async () => {
    expect(await verifyCrossChainSourceEffect(await fixture())).toEqual({ status: "confirmed-source" });
  });

  it("binds the observed transaction to the immutable prepared call", async () => {
    for (const changed of [{ from: recipient }, { to: pool }, { value: "1" }, { data: "0x5678" }, { chainId: 42161 }]) {
      const input = await fixture();
      if (input.observed.status === "found") input.observed.call = { ...input.call, ...changed };
      expect((await verifyCrossChainSourceEffect(input)).status).toBe("inconsistent");
    }
  });

  it("requires the reported hash and canonical finalized successful receipt", async () => {
    const wrongHash = await fixture(); wrongHash.expected.reportedHash = `0x${"c".repeat(64)}`;
    expect((await verifyCrossChainSourceEffect(wrongHash)).status).toBe("inconsistent");
    const reorg = await fixture(); if (reorg.observed.status === "found") reorg.observed.canonicalBlockHash = `0x${"c".repeat(64)}`;
    expect((await verifyCrossChainSourceEffect(reorg)).status).toBe("reorged");
    const pending = await fixture(); if (pending.observed.status === "found") pending.observed.finalizedBlockNumber = 99n;
    expect((await verifyCrossChainSourceEffect(pending)).status).toBe("pending");
    const reverted = await fixture(); if (reverted.observed.status === "found") reverted.observed.receipt!.status = "reverted";
    expect((await verifyCrossChainSourceEffect(reverted)).status).toBe("failed");
  });

  it("requires the exact wallet USDC debit", async () => {
    for (const logs of [[], [transfer(999_999n)], [transfer(1_000_000n, recipient)]]) {
      const input = await fixture();
      if (input.observed.status === "found") input.observed.receipt!.logs = [...logs, deposit()];
      expect((await verifyCrossChainSourceEffect(input)).status).toBe("inconsistent");
    }
  });

  it("requires exactly one matching official SpokePool deposit", async () => {
    const changes = [
      [deposit({ address: router })], [deposit(), deposit()],
      [deposit({ inputAmount: 999_999n })], [deposit({ outputAmount: 979_999n })],
      [deposit({ outputAmount: 990_001n })],
      [deposit({ destinationChainId: 8453n })], [deposit({ depositor: recipient })],
      [deposit({ recipient: wallet })], [deposit({ inputToken: arbUsdc })],
      [deposit({ outputToken: baseUsdc })], [deposit({ message: "0x01" })]
    ];
    for (const deposits of changes) {
      const input = await fixture();
      if (input.observed.status === "found") input.observed.receipt!.logs = [transfer(1_000_000n), ...deposits];
      expect((await verifyCrossChainSourceEffect(input)).status).toBe("inconsistent");
    }
  });

  it("binds the deposited quote and fill deadlines to the reviewed source call", async () => {
    const input = await fixture();
    input.expected.quoteTimestamp = 2;
    expect((await verifyCrossChainSourceEffect(input)).status).toBe("inconsistent");
    input.expected.quoteTimestamp = 1;
    input.expected.fillDeadline = 3;
    expect((await verifyCrossChainSourceEffect(input)).status).toBe("inconsistent");
  });
});
