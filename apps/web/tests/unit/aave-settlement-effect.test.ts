import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, parseAbiItem } from "viem";
import { AAVE_BASE_ASSETS, AAVE_BASE_V3_MARKET } from "@/lib/defi/aave";
import { verifyExpectedEffect } from "@/lib/transactions/effects";
import { normalizePreparedCall } from "@/lib/transactions/evidence";

const wallet = "0x2222222222222222222222222222222222222222";
const asset = AAVE_BASE_ASSETS.USDC;
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const amountRaw = 1_000_000n;
const events = {
  earn_supply: parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  earn_withdraw: parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)")
} as const;
type Action = keyof typeof events;
const topics = (value: unknown[]): string[] => value.flat(Infinity).filter((item): item is string => typeof item === "string");

function poolLog(action: Action, overrides: { actor?: string; asset?: string; amount?: bigint } = {}) {
  const actor = (overrides.actor ?? wallet) as `0x${string}`;
  const reserve = (overrides.asset ?? asset) as `0x${string}`;
  const amount = overrides.amount ?? amountRaw;
  if (action === "earn_supply") return {
    address: AAVE_BASE_V3_MARKET,
    topics: topics(encodeEventTopics({ abi: [events.earn_supply], eventName: "Supply", args: { reserve, onBehalfOf: actor, referralCode: 0 } })),
    data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [actor, amount])
  };
  return {
    address: AAVE_BASE_V3_MARKET,
    topics: topics(encodeEventTopics({ abi: [events.earn_withdraw], eventName: "Withdraw", args: { reserve, user: actor, to: actor } })),
    data: encodeAbiParameters([{ type: "uint256" }], [amount])
  };
}

async function evidence(action: Action) {
  const call = { chainId: 8453, from: wallet, to: AAVE_BASE_V3_MARKET, value: "0", data: "0x1234" };
  const normalized = await normalizePreparedCall(call);
  const prepared = { chainId: 8453, walletAddress: wallet, targetAddress: AAVE_BASE_V3_MARKET,
    nativeValue: "0", calldataHash: normalized.dataHash, semanticAction: action,
    expectedEffect: { type: action, asset, amountRaw: amountRaw.toString() }, reportedHash: hash, observedBlockHash: null };
  const observation = { status: "found" as const, call, receipt: { status: "success" as const,
    transactionHash: hash, blockHash, blockNumber: 100n, logs: [poolLog(action)] },
    blockHash, canonicalBlockHash: blockHash, confirmations: 3, finalizedBlockNumber: 100n };
  return { prepared, observation };
}

describe("Aave protocol settlement evidence", () => {
  it.each(["earn_supply", "earn_withdraw"] as const)("requires an exact finalized %s Pool event", async (action) => {
    const { prepared, observation } = await evidence(action);
    expect(await verifyExpectedEffect(prepared, observation)).toEqual({ status: "confirmed" });
    expect(await verifyExpectedEffect(prepared, { ...observation, receipt: { ...observation.receipt, logs: [] } })).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(prepared, { ...observation, receipt: { ...observation.receipt, logs: [poolLog(action, { actor: "0x3333333333333333333333333333333333333333" })] } })).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(prepared, { ...observation, receipt: { ...observation.receipt, logs: [poolLog(action, { amount: 999_999n })] } })).toMatchObject({ status: "inconsistent" });
    expect(await verifyExpectedEffect(prepared, { ...observation, receipt: { ...observation.receipt, logs: [poolLog(action, { asset: AAVE_BASE_ASSETS.WETH })] } })).toMatchObject({ status: "inconsistent" });
  });

  it("does not confirm retired borrow or repay effects", async () => {
    const { prepared, observation } = await evidence("earn_supply");
    for (const type of ["borrow", "repay"]) {
      expect(await verifyExpectedEffect({ ...prepared, semanticAction: type,
        expectedEffect: { type, asset, amountRaw: amountRaw.toString() } }, observation)).toMatchObject({ status: "inconsistent" });
    }
  });
});
