import { beforeEach, describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, padHex, parseAbiItem } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

const state = vi.hoisted(() => ({ observed: null as unknown, candidate: null as null | Record<string, unknown>, writes: [] as string[] }));
vi.mock("@/lib/transactions/chain-observation", () => ({ observeTransaction: async () => state.observed }));

import { reconcileLateObservations } from "@/lib/transactions/late-observation";

const wallet = "0x1111111111111111111111111111111111111111";
const diamond = "0x3333333333333333333333333333333333333333";
const pool = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";
const baseUsdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const arbUsdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const word = (address: string) => padHex(address as `0x${string}`, { size: 32 });
const depositEvent = parseAbiItem("event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)");

async function fixture() {
  const call = await normalizePreparedCall({ chainId: 8453, from: wallet, to: diamond, value: "0", data: "0x1234" });
  const args = { inputToken: word(baseUsdc), outputToken: word(arbUsdc), inputAmount: 997_500n,
    outputAmount: 990_000n, destinationChainId: 42161n, depositId: 7n, quoteTimestamp: 1,
    fillDeadline: 2, exclusivityDeadline: 0, depositor: word(wallet), recipient: word(wallet),
    exclusiveRelayer: word("0x0000000000000000000000000000000000000000"), message: "0x" as const };
  const nonIndexed = depositEvent.inputs.filter((input) => !("indexed" in input && input.indexed));
  const logs = [{ address: baseUsdc,
    topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: wallet, to: pool } }).map(String),
    data: `0x${(1_000_000n).toString(16).padStart(64, "0")}` },
  { address: pool,
    topics: encodeEventTopics({ abi: [depositEvent], eventName: "FundsDeposited", args: {
      destinationChainId: 42161n, depositId: 7n, depositor: word(wallet) } }).map(String),
    data: encodeAbiParameters(nonIndexed, nonIndexed.map((input) => args[input.name as keyof typeof args])) }];
  state.observed = { status: "found", call, blockHash, canonicalBlockHash: blockHash,
    confirmations: 5, finalizedBlockNumber: 100n,
    receipt: { status: "success", transactionHash: hash, blockHash, blockNumber: 100n, logs } };
  state.candidate = { report_id: "report-1", intent_id: "intent-1", step_index: 0, transaction_hash: hash,
    chain_id: 8453, wallet_address: wallet, target_address: diamond, native_value: "0",
    calldata_hash: call.dataHash, prepared_fingerprint: call.fingerprint, semantic_action: "bridge",
    expected_effect_json: JSON.stringify({ type: "bridge", wallet, recipient: wallet,
      sourceChainId: 8453, destinationChainId: 42161, sourceAmountRaw: "1000000",
      bridgeAmountRaw: "997500", bridgeOutputRaw: "990000", minimumOutputRaw: "980000",
      quoteTimestamp: 1, fillDeadline: 2 }), intent_status: "cancelled", intent_type: "bridge" };
}

function database() {
  return { prepare(query: string) {
    return { bind() {
      return { async all() { return { results: state.candidate ? [state.candidate] : [] }; },
        async run() { state.writes.push(query); return { meta: { changes: 1 } }; } };
    } };
  }, async batch(statements: Array<{ run: () => Promise<unknown> }>) {
    for (const statement of statements) await statement.run();
  } } as unknown as D1Database;
}

beforeEach(async () => { state.writes = []; await fixture(); });

describe("late bridge observation", () => {
  it("retains a verified source deposit without reopening the closed intent or confirming destination settlement", async () => {
    expect(await reconcileLateObservations(database(), "subject-a"))
      .toEqual([{ reportId: "report-1", verificationState: "identity_matched" }]);
    expect(state.writes.some((sql) => sql.includes("UPDATE transaction_intents") || sql.includes("SET reported_hash"))).toBe(false);
  });

  it("alerts an operator to a late source deposit even while the intent is only reviewed", async () => {
    state.candidate!.intent_status = "reviewed";
    expect(await reconcileLateObservations(database(), "subject-a"))
      .toEqual([{ reportId: "report-1", verificationState: "identity_matched" }]);
    expect(state.writes.some((sql) => sql.includes("INSERT INTO operational_issues"))).toBe(true);
  });

  it("rejects a changed call even with an otherwise valid Across deposit", async () => {
    (state.observed as { call: Record<string, unknown> }).call = { ...(state.observed as { call: Record<string, unknown> }).call, to: pool };
    expect(await reconcileLateObservations(database(), "subject-a"))
      .toEqual([{ reportId: "report-1", verificationState: "identity_mismatch" }]);
  });

  it("never treats a noncanonical source block as verified", async () => {
    (state.observed as { canonicalBlockHash: string }).canonicalBlockHash = `0x${"c".repeat(64)}`;
    expect(await reconcileLateObservations(database(), "subject-a"))
      .toEqual([{ reportId: "report-1", verificationState: "check_failed" }]);
  });
});
