import { decodeEventLog, erc20Abi, isAddress } from "viem";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { requiredConfirmations } from "@/lib/transactions/effects";
import { matchesPreparedCall, type NormalizedPreparedCall } from "@/lib/transactions/evidence";

type Expected = { wallet: string; token: string; spender: string; amountRaw: string; reportedHash: string };
type Result = { status: "confirmed" | "pending" | "failed" | "inconsistent" | "reorged"; reason?: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** Approval evidence is separate from a Swap receipt and never confirms the Swap itself. */
export async function verifySwapApprovalEffect(input: {
  call: NormalizedPreparedCall; observed: ChainObservation; expected: Expected;
}): Promise<Result> {
  const { call, observed, expected } = input;
  if (call.chainId !== 8453 || !isAddress(expected.wallet) || !isAddress(expected.token)
    || !isAddress(expected.spender) || !/^\d+$/.test(expected.amountRaw)
    || !/^0x[0-9a-f]{64}$/i.test(expected.reportedHash)
    || !same(call.from, expected.wallet) || !same(call.to, expected.token) || call.value !== "0")
    return { status: "inconsistent", reason: "expectation" };
  if (observed.status === "pending") return { status: "pending", reason: "transaction_unavailable" };
  if (!(await matchesPreparedCall(call, observed.call)).matches)
    return { status: "inconsistent", reason: "transaction_identity" };
  if (!observed.receipt) return { status: "pending", reason: "receipt_unavailable" };
  const receipt = observed.receipt;
  if (!same(receipt.transactionHash, expected.reportedHash))
    return { status: "inconsistent", reason: "transaction_hash" };
  if (!observed.blockHash || !observed.canonicalBlockHash
    || !same(receipt.blockHash, observed.blockHash) || !same(observed.canonicalBlockHash, observed.blockHash))
    return { status: "reorged", reason: "canonical_block" };
  if (observed.confirmations < requiredConfirmations(8453)
    || observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber)
    return { status: "pending", reason: "finality" };
  if (receipt.status === "reverted") return { status: "failed", reason: "reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_unknown" };
  let matches = 0;
  for (const log of receipt.logs) {
    if (!same(log.address, expected.token)) continue;
    try {
      const event = decodeEventLog({ abi: erc20Abi, eventName: "Approval", data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (same(event.args.owner, expected.wallet) && same(event.args.spender, expected.spender)
        && event.args.value === BigInt(expected.amountRaw)) matches++;
    } catch { /* Other logs are not approval evidence. */ }
  }
  return matches === 1 ? { status: "confirmed" } : { status: "inconsistent", reason: "approval_effect" };
}
