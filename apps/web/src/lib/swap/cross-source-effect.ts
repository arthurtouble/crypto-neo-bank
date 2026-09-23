import { decodeEventLog, erc20Abi, getAddress, isAddress, padHex, parseAbiItem } from "viem";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { requiredConfirmations } from "@/lib/transactions/effects";
import { matchesPreparedCall, type NormalizedPreparedCall } from "@/lib/transactions/evidence";

type Expected = {
  wallet: string; recipient: string; sourceChainId: number; destinationChainId: number;
  sourceAmountRaw: string; bridgeAmountRaw: string; bridgeOutputRaw: string;
  minimumOutputRaw: string; quoteTimestamp: number; fillDeadline: number; reportedHash: string;
};
type Result = { status: "pending" | "inconsistent" | "reorged" | "failed" | "confirmed-source"; reason?: string };
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const chains = {
  8453: { pool: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64", usdc: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" },
  42161: { pool: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A", usdc: "0xaf88d065e77c8cc2239327c5edb3a432268e5831" }
} as const;
// Across V4 bytes32 event, matching the deposit ABI in destination-evidence.ts.
const FUNDS_DEPOSITED = parseAbiItem("event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)");
const depositTopic = "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3";
const word = (address: string) => padHex(getAddress(address), { size: 32 }).toLowerCase();

/** Proves a reviewed Across source deposit only; destination settlement needs separate evidence. */
export async function verifyCrossChainSourceEffect(input: {
  call: NormalizedPreparedCall; observed: ChainObservation; expected: Expected;
}): Promise<Result> {
  const { call, observed, expected } = input;
  const source = chains[expected.sourceChainId as keyof typeof chains];
  const destination = chains[expected.destinationChainId as keyof typeof chains];
  if (!source || !destination || expected.sourceChainId === expected.destinationChainId
    || call.chainId !== expected.sourceChainId || call.value !== "0"
    || !isAddress(expected.wallet) || !isAddress(expected.recipient)
    || !same(call.from, expected.wallet)
    || !/^[1-9]\d*$/.test(expected.sourceAmountRaw)
    || !/^[1-9]\d*$/.test(expected.bridgeAmountRaw)
    || !/^[1-9]\d*$/.test(expected.bridgeOutputRaw)
    || !/^[1-9]\d*$/.test(expected.minimumOutputRaw)
    || BigInt(expected.bridgeAmountRaw) > BigInt(expected.sourceAmountRaw)
    || BigInt(expected.bridgeOutputRaw) < BigInt(expected.minimumOutputRaw)
    || !Number.isSafeInteger(expected.quoteTimestamp) || !Number.isSafeInteger(expected.fillDeadline)
    || expected.quoteTimestamp < 0 || expected.fillDeadline <= expected.quoteTimestamp
    || !/^0x[a-f0-9]{64}$/i.test(expected.reportedHash))
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
  if (observed.confirmations < requiredConfirmations(call.chainId)
    || observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber)
    return { status: "pending", reason: "finality" };
  if (receipt.status === "reverted") return { status: "failed", reason: "source_reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "receipt_unknown" };

  let debited = 0n;
  for (const log of receipt.logs) {
    if (!same(log.address, source.usdc)) continue;
    try {
      const transfer = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (same(transfer.args.from, expected.wallet)) debited += transfer.args.value;
    } catch { /* Other USDC logs are not a wallet debit. */ }
  }
  if (debited !== BigInt(expected.sourceAmountRaw))
    return { status: "inconsistent", reason: "source_debit" };

  const deposits = receipt.logs.filter((log) => same(log.address, source.pool) && same(log.topics[0] ?? "", depositTopic));
  if (deposits.length !== 1) return { status: "inconsistent", reason: "across_deposit" };
  try {
    const deposit = decodeEventLog({ abi: [FUNDS_DEPOSITED], eventName: "FundsDeposited",
      data: deposits[0].data as `0x${string}`,
      topics: deposits[0].topics as [`0x${string}`, ...`0x${string}`[]] }).args;
    if (deposit.destinationChainId !== BigInt(expected.destinationChainId)
      || deposit.inputToken.toLowerCase() !== word(source.usdc)
      || deposit.outputToken.toLowerCase() !== word(destination.usdc)
      || deposit.inputAmount !== BigInt(expected.bridgeAmountRaw)
      || deposit.outputAmount !== BigInt(expected.bridgeOutputRaw)
      || deposit.quoteTimestamp !== expected.quoteTimestamp
      || deposit.fillDeadline !== expected.fillDeadline
      || deposit.depositor.toLowerCase() !== word(expected.wallet)
      || deposit.recipient.toLowerCase() !== word(expected.recipient)
      || deposit.message !== "0x") return { status: "inconsistent", reason: "across_deposit" };
  } catch { return { status: "inconsistent", reason: "across_deposit" }; }
  return { status: "confirmed-source" };
}
