import { decodeEventLog, erc20Abi, isAddress } from "viem";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { requiredConfirmations } from "@/lib/transactions/effects";
import { matchesPreparedCall, type NormalizedPreparedCall } from "@/lib/transactions/evidence";
import { parseAssetId } from "./assets";

type ExpectedSwap = {
  wallet: string; sourceAssetId: string; destinationAssetId: string;
  sourceAmountRaw: string; minimumOutputRaw: string; reportedHash: string;
};
type Result = { status: "confirmed" | "pending" | "partial" | "failed" | "inconsistent" | "reorged"; reason?: string; receivedRaw?: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

function transferTotal(logs: NonNullable<Extract<ChainObservation, { status: "found" }>["receipt"]>["logs"], token: string,
  wallet: string, direction: "from" | "to"): bigint {
  let total = 0n;
  for (const log of logs) {
    if (!same(log.address, token)) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (same(decoded.args[direction], wallet)) total += decoded.args.value;
    } catch { /* This is not a matching token transfer. */ }
  }
  return total;
}

/** Independently verifies exact source transaction and same-chain token effects. */
export async function verifySameChainSwapEffect(input: {
  call: NormalizedPreparedCall; observed: ChainObservation; expected: ExpectedSwap;
}): Promise<Result> {
  const { call, observed, expected } = input;
  const source = parseAssetId(expected.sourceAssetId);
  const destination = parseAssetId(expected.destinationAssetId);
  if (!source || !destination || source.chainId !== destination.chainId || source.chainId !== call.chainId
    || !isAddress(expected.wallet) || !/^[1-9]\d*$/.test(expected.sourceAmountRaw)
    || !/^[1-9]\d*$/.test(expected.minimumOutputRaw)
    || !/^0x[0-9a-f]{64}$/i.test(expected.reportedHash) || !same(call.from, expected.wallet))
    return { status: "inconsistent", reason: "expectation" };
  if (observed.status === "pending") return { status: "pending", reason: "transaction_unavailable" };
  if (!(await matchesPreparedCall(call, observed.call)).matches) return { status: "inconsistent", reason: "transaction_identity" };
  if (!observed.receipt) return { status: "pending", reason: "receipt_unavailable" };
  const receipt = observed.receipt;
  if (!same(receipt.transactionHash, expected.reportedHash)) return { status: "inconsistent", reason: "transaction_hash" };
  if (!observed.blockHash || !observed.canonicalBlockHash
    || !same(receipt.blockHash, observed.blockHash) || !same(observed.canonicalBlockHash, observed.blockHash))
    return { status: "reorged", reason: "canonical_block" };
  if (observed.confirmations < requiredConfirmations(call.chainId)
    || observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber)
    return { status: "pending", reason: "finality" };
  if (receipt.status === "reverted") return { status: "failed", reason: "source_reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_unknown" };
  const debited = source.address === null ? BigInt(call.value)
    : transferTotal(receipt.logs, source.address, expected.wallet, "from");
  if (debited !== BigInt(expected.sourceAmountRaw)) return { status: "inconsistent", reason: "source_debit" };
  // A receipt does not reveal internal native ETH payouts. Those require a separate trace/balance proof.
  if (destination.address === null) return { status: "pending", reason: "native_effect_unavailable" };
  const received = transferTotal(receipt.logs, destination.address, expected.wallet, "to");
  if (received === 0n) return { status: "inconsistent", reason: "destination_credit" };
  if (received < BigInt(expected.minimumOutputRaw)) return { status: "partial", reason: "minimum_not_met", receivedRaw: received.toString() };
  return { status: "confirmed" };
}
