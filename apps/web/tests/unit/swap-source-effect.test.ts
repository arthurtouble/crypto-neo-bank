import { describe, expect, it } from "vitest";
import { encodeEventTopics, erc20Abi } from "viem";
import { normalizePreparedCall } from "@/lib/transactions/evidence";
import { verifySameChainSwapEffect } from "@/lib/swap/source-effect";
import type { ChainObservation } from "@/lib/transactions/chain-observation";

const wallet = "0x1111111111111111111111111111111111111111";
const router = "0x2222222222222222222222222222222222222222";
const source = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const destination = "0x4200000000000000000000000000000000000006";
const hash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const transfer = (token: `0x${string}`, from: `0x${string}`, to: `0x${string}`, value: bigint) => ({
  address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from, to } }).map(String),
  data: `0x${value.toString(16).padStart(64, "0")}`
});

async function fixture() {
  const call = await normalizePreparedCall({ chainId: 8453, from: wallet, to: router, value: "0", data: "0x1234" });
  const observed: ChainObservation = { status: "found", call, blockHash,
    receipt: { status: "success", transactionHash: hash, blockHash, blockNumber: 100n,
      logs: [transfer(source, wallet, router, 1_000_000n), transfer(destination, router, wallet, 900_000_000_000_000_000n)] },
    canonicalBlockHash: blockHash, confirmations: 5, finalizedBlockNumber: 100n };
  return { call, observed, expected: { wallet, sourceAssetId: `8453:${source.toLowerCase()}`,
    destinationAssetId: `8453:${destination.toLowerCase()}`, sourceAmountRaw: "1000000",
    minimumOutputRaw: "800000000000000000", reportedHash: hash } };
}

describe("same-chain Swap settlement evidence", () => {
  it("confirms only exact prepared calldata with source debit and minimum destination credit", async () => {
    const input = await fixture();
    expect(await verifySameChainSwapEffect(input)).toEqual({ status: "confirmed" });
  });

  it("rejects an unrelated destination credit or changed signed transaction", async () => {
    const unrelated = await fixture();
    if (unrelated.observed.status === "found") unrelated.observed.receipt!.logs[1] = transfer(destination, router, router, 900_000_000_000_000_000n);
    expect((await verifySameChainSwapEffect(unrelated)).status).not.toBe("confirmed");
    const changed = await fixture();
    if (changed.observed.status === "found") changed.observed.call = { ...changed.call, data: "0x5678" };
    expect((await verifySameChainSwapEffect(changed)).status).toBe("inconsistent");
  });

  it("does not complete source-only, insufficient-output, or unfinalized receipts", async () => {
    const sourceOnly = await fixture();
    if (sourceOnly.observed.status === "found") sourceOnly.observed.receipt!.logs.pop();
    expect((await verifySameChainSwapEffect(sourceOnly)).status).not.toBe("confirmed");
    const short = await fixture(); short.expected.minimumOutputRaw = "900000000000000001";
    expect((await verifySameChainSwapEffect(short)).status).toBe("partial");
    const pending = await fixture();
    if (pending.observed.status === "found") pending.observed.finalizedBlockNumber = 99n;
    expect((await verifySameChainSwapEffect(pending)).status).toBe("pending");
  });
});
