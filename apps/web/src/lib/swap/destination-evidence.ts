import { decodeEventLog, erc20Abi, isAddress } from "viem";
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
  if (!link || !isAddress(link.sourceContract) || !isAddress(link.destinationContract)
    || !hashPattern.test(link.sourceEventTopic) || !hashPattern.test(link.destinationEventTopic)
    || !Number.isSafeInteger(link.messageTopicIndex) || link.messageTopicIndex < 1 || link.messageTopicIndex > 3) {
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
  const sourceMessage = bridgeMessage(source.receipt.logs, link.sourceContract, link.sourceEventTopic, link.messageTopicIndex);
  if (!sourceMessage) return { status: "pending", reason: "bridge_link_unverified" };
  const destinationMessage = bridgeMessage(receipt.logs, link.destinationContract, link.destinationEventTopic, link.messageTopicIndex);
  if (!destinationMessage) return { status: "pending", reason: "bridge_link_unverified" };
  if (destinationMessage !== sourceMessage) return { status: "inconsistent", reason: "bridge_message_mismatch" };

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
