import { describe, expect, it } from "vitest";
import { encodeEventTopics, erc20Abi } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { verifySwapApprovalEffect } from "@/lib/swap/approval-effect";
import type { ChainObservation } from "@/lib/transactions/chain-observation";

const wallet = "0x1111111111111111111111111111111111111111";
const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const spender = "0x2626664c2603336E57B271c5C0b26F421741e481";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;

async function fixture(amount = 1_000_000n) {
  const call = await normalizePreparedCall({ chainId: 8453, from: wallet, to: token, value: "0", data: "0x1234" });
  const observed: ChainObservation = { status: "found", call, blockHash,
    receipt: { status: "success", transactionHash: hash, blockHash, blockNumber: 100n,
      logs: [{ address: token,
        topics: encodeEventTopics({ abi: erc20Abi, eventName: "Approval", args: { owner: wallet, spender } }).map(String),
        data: `0x${amount.toString(16).padStart(64, "0")}` }] },
    canonicalBlockHash: blockHash, confirmations: 5, finalizedBlockNumber: 100n };
  return { call, observed, expected: { wallet, token, spender, amountRaw: amount.toString(), reportedHash: hash } };
}

describe("swap approval effect", () => {
  it("confirms an exact, finalized approval event and a zero reset", async () => {
    expect((await verifySwapApprovalEffect(await fixture())).status).toBe("confirmed");
    expect((await verifySwapApprovalEffect(await fixture(0n))).status).toBe("confirmed");
  });

  it("never confirms wrong calldata, spender, amount, or unfinalized receipt", async () => {
    const wrongCall = await fixture();
    if (wrongCall.observed.status === "found") wrongCall.observed.call = { ...wrongCall.call, data: "0x5678" };
    expect((await verifySwapApprovalEffect(wrongCall)).status).toBe("inconsistent");
    const wrongSpender = await fixture(); wrongSpender.expected.spender = wallet;
    expect((await verifySwapApprovalEffect(wrongSpender)).status).toBe("inconsistent");
    const wrongAmount = await fixture(); wrongAmount.expected.amountRaw = "2";
    expect((await verifySwapApprovalEffect(wrongAmount)).status).toBe("inconsistent");
    const pending = await fixture();
    if (pending.observed.status === "found") pending.observed.finalizedBlockNumber = 99n;
    expect((await verifySwapApprovalEffect(pending)).status).toBe("pending");
  });
});
