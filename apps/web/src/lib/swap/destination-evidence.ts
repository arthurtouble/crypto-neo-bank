import { decodeEventLog, erc20Abi, getAddress, isAddress, padHex, parseAbiItem } from "viem";
import type { ChainObservation } from "@/lib/transactions/chain-observation";
import { requiredConfirmations } from "@/lib/transactions/effects";

type ProviderStatus = "PENDING" | "DONE" | "PARTIAL" | "REFUNDED" | "FAILED";

export type SwapDestinationEvidence = {
  expected: {
    sourceHash: string;
    sourceChainId: number;
    destinationChainId: number;
    destinationToken: string | null;
    recipient: string;
    minimumAmountRaw: string;
    /** Initial Across evidence profile: Base USDC <-> Arbitrum USDC, without messages or recipient changes. */
    across?: { sourceToken: string; sourceAmountRaw: string; depositor: string };
    /** Reviewed bridge-adapter event identity, never copied from the quote/status response. */
    bridgeLink?: {
      sourceContract: string;
      sourceEventTopic: string;
      destinationContract: string;
      destinationEventTopic: string;
      messageTopicIndex: number;
    };
    /** Previously retained receipt block hash, if the destination was observed before. */
    previousBlockHash?: string | null;
  };
  provider: {
    status: ProviderStatus;
    sourceHash: string | null;
    destinationChainId: number | null;
    destinationHash: string | null;
  };
  /** Hash actually requested from the destination-chain observer. */
  observedHash: string | null;
  sourceObserved?: ChainObservation | null;
  observed: ChainObservation;
};

export type SwapDestinationResult =
  | { status: "complete" }
  | { status: "pending" | "inconsistent" | "reorged" | "failed" | "refund_reported"; reason: string }
  | { status: "partial"; reason: string; amountRaw?: string };

const hashPattern = /^0x[a-f0-9]{64}$/i;
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
const ZERO_WORD = `0x${"0".repeat(64)}`;
const ACROSS_DEPOSIT_TOPIC = "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3";
const ACROSS_FILL_TOPIC = "0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208";
const ACROSS_POOLS: Readonly<Record<number, string>> = {
  8453: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
  42161: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A"
};
const ACROSS_USDC: Readonly<Record<number, string>> = {
  8453: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  42161: "0xaf88d065e77c8cc2239327c5edb3a432268e5831"
};
// Across's current bytes32 events: https://docs.across.to/guides/migration/non-evm/indexers
const FUNDS_DEPOSITED = parseAbiItem("event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)");
const FILLED_RELAY = parseAbiItem("event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)");

function acrossLink(source: Extract<ChainObservation, { status: "found" }>, destination: Extract<ChainObservation, { status: "found" }>, expected: SwapDestinationEvidence["expected"]): SwapDestinationResult | null {
  const across = expected.across;
  if (!across || !source.receipt || !destination.receipt) return { status: "pending", reason: "bridge_link_unverified" };
  const sourcePool = ACROSS_POOLS[expected.sourceChainId];
  const destinationPool = ACROSS_POOLS[expected.destinationChainId];
  if (!sourcePool || !destinationPool || sourcePool === destinationPool
    || !isAddress(across.depositor) || !isAddress(across.sourceToken)
    || !expected.destinationToken || !/^[1-9]\d*$/.test(across.sourceAmountRaw)
    || !same(across.sourceToken, ACROSS_USDC[expected.sourceChainId])
    || !same(expected.destinationToken, ACROSS_USDC[expected.destinationChainId])
    || !same(source.call.from, across.depositor)) return { status: "inconsistent", reason: "across_expectation" };
  const word = (address: string) => padHex(getAddress(address), { size: 32 }).toLowerCase();
  const sourceLogs = source.receipt.logs.filter((log) => same(log.address, sourcePool)
    && same(log.topics[0] ?? "", ACROSS_DEPOSIT_TOPIC));
  const destinationLogs = destination.receipt.logs.filter((log) => same(log.address, destinationPool)
    && same(log.topics[0] ?? "", ACROSS_FILL_TOPIC));
  if (sourceLogs.length !== 1 || destinationLogs.length !== 1) return { status: "pending", reason: "bridge_link_unverified" };
  try {
    const deposit = decodeEventLog({ abi: [FUNDS_DEPOSITED], eventName: "FundsDeposited",
      data: sourceLogs[0].data as `0x${string}`, topics: sourceLogs[0].topics as [`0x${string}`, ...`0x${string}`[]] }).args;
    const fill = decodeEventLog({ abi: [FILLED_RELAY], eventName: "FilledRelay",
      data: destinationLogs[0].data as `0x${string}`, topics: destinationLogs[0].topics as [`0x${string}`, ...`0x${string}`[]] }).args;
    if (deposit.destinationChainId !== BigInt(expected.destinationChainId)
      || deposit.inputToken.toLowerCase() !== word(across.sourceToken)
      || deposit.outputToken.toLowerCase() !== word(expected.destinationToken)
      || deposit.inputAmount !== BigInt(across.sourceAmountRaw)
      || deposit.outputAmount < BigInt(expected.minimumAmountRaw)
      || deposit.depositor.toLowerCase() !== word(across.depositor)
      || deposit.recipient.toLowerCase() !== word(expected.recipient)
      || deposit.message !== "0x"
      || fill.originChainId !== BigInt(expected.sourceChainId)
      || fill.depositId !== deposit.depositId
      || fill.inputToken !== deposit.inputToken || fill.outputToken !== deposit.outputToken
      || fill.inputAmount !== deposit.inputAmount || fill.outputAmount !== deposit.outputAmount
      || fill.fillDeadline !== deposit.fillDeadline || fill.exclusivityDeadline !== deposit.exclusivityDeadline
      || fill.exclusiveRelayer !== deposit.exclusiveRelayer
      || fill.depositor !== deposit.depositor || fill.recipient !== deposit.recipient
      || fill.messageHash.toLowerCase() !== ZERO_WORD
      || fill.relayExecutionInfo.updatedRecipient !== deposit.recipient
      || fill.relayExecutionInfo.updatedMessageHash.toLowerCase() !== ZERO_WORD
      || fill.relayExecutionInfo.updatedOutputAmount < BigInt(expected.minimumAmountRaw)
      || fill.relayExecutionInfo.fillType > 2) return { status: "inconsistent", reason: "across_relay_mismatch" };
  } catch { return { status: "pending", reason: "bridge_link_unverified" }; }
  return null;
}

function bridgeMessage(logs: Array<{ address: string; topics: string[] }>, contract: string, eventTopic: string, index: number): string | null {
  const messages = new Set(logs.filter((log) => same(log.address, contract) && log.topics[0] && same(log.topics[0], eventTopic))
    .map((log) => log.topics[index]).filter((topic) => typeof topic === "string" && hashPattern.test(topic)).map((topic) => topic.toLowerCase()));
  return messages.size === 1 ? [...messages][0] : null;
}

/** Provider status is linkage evidence, never proof of destination settlement by itself. */
export function verifySwapDestination(input: SwapDestinationEvidence): SwapDestinationResult {
  const { expected, provider, observed } = input;
  if (!hashPattern.test(expected.sourceHash) || !isAddress(expected.recipient)
    || expected.destinationToken !== null && !isAddress(expected.destinationToken)
    || !Number.isSafeInteger(expected.sourceChainId) || expected.sourceChainId <= 0
    || !Number.isSafeInteger(expected.destinationChainId) || expected.destinationChainId <= 0
    || !/^[1-9]\d*$/.test(expected.minimumAmountRaw)) {
    return { status: "inconsistent", reason: "invalid_expectation" };
  }
  if (!provider.sourceHash || !hashPattern.test(provider.sourceHash) || !same(provider.sourceHash, expected.sourceHash)) {
    return { status: "inconsistent", reason: "source_hash" };
  }
  if (provider.status === "REFUNDED") return { status: "refund_reported", reason: "provider_refund_unverified" };
  if (provider.status === "FAILED") return { status: "failed", reason: "provider_failure" };
  if (provider.status === "PARTIAL") return { status: "partial", reason: "provider_partial" };
  if (provider.status !== "DONE") return { status: "pending", reason: "provider_pending" };
  if (provider.destinationChainId !== expected.destinationChainId) return { status: "inconsistent", reason: "destination_chain" };
  if (!provider.destinationHash || !hashPattern.test(provider.destinationHash)) return { status: "pending", reason: "destination_hash_unavailable" };
  if (!input.observedHash || !hashPattern.test(input.observedHash) || !same(input.observedHash, provider.destinationHash)) {
    return { status: "inconsistent", reason: "destination_hash" };
  }
  if (observed.status === "pending") return { status: "pending", reason: "destination_unavailable" };
  if (observed.call.chainId !== expected.destinationChainId) return { status: "inconsistent", reason: "destination_chain" };
  if (!observed.receipt) return { status: "pending", reason: "destination_receipt_unavailable" };
  const receipt = observed.receipt;
  if (!hashPattern.test(receipt.transactionHash) || !same(receipt.transactionHash, provider.destinationHash)) {
    return { status: "inconsistent", reason: "destination_hash" };
  }
  if (!observed.blockHash || !observed.canonicalBlockHash || !same(receipt.blockHash, observed.blockHash)
    || !same(observed.canonicalBlockHash, observed.blockHash)
    || expected.previousBlockHash && !same(expected.previousBlockHash, observed.blockHash)) {
    return { status: "reorged", reason: "destination_block" };
  }
  if (observed.confirmations < requiredConfirmations(expected.destinationChainId)
    || observed.finalizedBlockNumber === null || observed.finalizedBlockNumber < receipt.blockNumber) {
    return { status: "pending", reason: "finality" };
  }
  if (receipt.status === "reverted") return { status: "failed", reason: "destination_reverted" };
  if (receipt.status !== "success") return { status: "pending", reason: "destination_receipt_unknown" };

  const link = expected.bridgeLink;
  if (!expected.across && link && (same(link.sourceEventTopic, ACROSS_DEPOSIT_TOPIC)
    || same(link.destinationEventTopic, ACROSS_FILL_TOPIC))) return { status: "pending", reason: "bridge_link_unverified" };
  if (!expected.across && (!link || !isAddress(link.sourceContract) || !isAddress(link.destinationContract)
    || !hashPattern.test(link.sourceEventTopic) || !hashPattern.test(link.destinationEventTopic)
    || !Number.isSafeInteger(link.messageTopicIndex) || link.messageTopicIndex < 1 || link.messageTopicIndex > 3)) {
    return { status: "pending", reason: "bridge_link_unverified" };
  }
  const source = input.sourceObserved;
  if (!source || source.status === "pending") return { status: "pending", reason: "bridge_link_unverified" };
  if (source.call.chainId !== expected.sourceChainId || !source.receipt
    || !same(source.receipt.transactionHash, expected.sourceHash)) return { status: "inconsistent", reason: "source_receipt" };
  if (!source.blockHash || !source.canonicalBlockHash || !same(source.receipt.blockHash, source.blockHash)
    || !same(source.canonicalBlockHash, source.blockHash)) return { status: "reorged", reason: "source_block" };
  if (source.confirmations < requiredConfirmations(expected.sourceChainId)
    || source.finalizedBlockNumber === null || source.finalizedBlockNumber < source.receipt.blockNumber) {
    return { status: "pending", reason: "source_finality" };
  }
  if (source.receipt.status !== "success") return { status: "failed", reason: "source_not_successful" };
  if (expected.across) {
    const linked = acrossLink(source, observed, expected);
    if (linked) return linked;
  } else {
    const sourceMessage = bridgeMessage(source.receipt.logs, link!.sourceContract, link!.sourceEventTopic, link!.messageTopicIndex);
    if (!sourceMessage) return { status: "pending", reason: "bridge_link_unverified" };
    const destinationMessage = bridgeMessage(receipt.logs, link!.destinationContract, link!.destinationEventTopic, link!.messageTopicIndex);
    if (!destinationMessage) return { status: "pending", reason: "bridge_link_unverified" };
    if (destinationMessage !== sourceMessage) return { status: "inconsistent", reason: "bridge_message_mismatch" };
  }

  if (expected.destinationToken === null) {
    // Internal native bridge payouts need balance-delta or trace evidence; an outer receipt cannot prove them.
    if (!same(observed.call.to, expected.recipient) || observed.call.data !== "0x"
      || !/^\d+$/.test(String(observed.call.value))) return { status: "pending", reason: "native_effect_unavailable" };
    const received = BigInt(observed.call.value);
    if (received < BigInt(expected.minimumAmountRaw)) return { status: "partial", reason: "minimum_not_met", amountRaw: received.toString() };
    return { status: "complete" };
  }

  let credited = 0n;
  for (const log of receipt.logs) {
    if (!same(log.address, expected.destinationToken)) continue;
    try {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: "Transfer", data: log.data as `0x${string}`,
        topics: log.topics as [`0x${string}`, ...`0x${string}`[]] });
      if (same(decoded.args.to, expected.recipient)) credited += decoded.args.value;
    } catch { /* Unrelated or malformed log is not destination evidence. */ }
  }
  if (credited === 0n) return { status: "inconsistent", reason: "destination_effect" };
  if (credited < BigInt(expected.minimumAmountRaw)) return { status: "partial", reason: "minimum_not_met", amountRaw: credited.toString() };
  return { status: "complete" };
}
