import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, erc20Abi, padHex, parseAbiItem, type AbiParameter } from "viem";
import { verifySwapDestination, type SwapDestinationEvidence } from "@/lib/swap/destination-evidence";

const sourceHash = `0x${"a".repeat(64)}`;
const destinationHash = `0x${"b".repeat(64)}`;
const blockHash = `0x${"c".repeat(64)}`;
const token = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const recipient = "0x1111111111111111111111111111111111111111";
const sender = "0x2222222222222222222222222222222222222222";
const bridge = "0x3333333333333333333333333333333333333333";
const messageId = `0x${"d".repeat(64)}`;
const sourceEvent = `0x${"e".repeat(64)}`;
const destinationEvent = `0x${"f".repeat(64)}`;
const sourceBlockHash = `0x${"1".repeat(64)}`;

type Found = Extract<SwapDestinationEvidence["observed"], { status: "found" }>;
type FoundEvidence = SwapDestinationEvidence & { observed: Found; sourceObserved: Found };

function fixture(): FoundEvidence {
  return {
    expected: { sourceHash, sourceChainId: 1, destinationChainId: 8453, destinationToken: token, recipient, minimumAmountRaw: "900000",
      bridgeLink: { sourceContract: bridge, sourceEventTopic: sourceEvent,
        destinationContract: bridge, destinationEventTopic: destinationEvent, messageTopicIndex: 1 } },
    provider: { status: "DONE", sourceHash, destinationChainId: 8453, destinationHash },
    observedHash: destinationHash,
    sourceObserved: { status: "found", call: { chainId: 1, from: sender, to: bridge, value: "0", data: "0x1234" },
      blockHash: sourceBlockHash, receipt: { status: "success", transactionHash: sourceHash,
        blockHash: sourceBlockHash, blockNumber: 100n, logs: [{ address: bridge, topics: [sourceEvent, messageId], data: "0x" }] },
      canonicalBlockHash: sourceBlockHash, confirmations: 13, finalizedBlockNumber: 100n },
    observed: {
      status: "found",
      call: { chainId: 8453, from: bridge, to: token, value: "0", data: "0x1234" },
      blockHash,
      receipt: {
        status: "success", transactionHash: destinationHash, blockHash, blockNumber: 100n,
        logs: [{ address: bridge, topics: [destinationEvent, messageId], data: "0x" },
          { address: token, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: sender, to: recipient } }).map(String),
            data: `0x${(1_000_000n).toString(16).padStart(64, "0")}` }]
      },
      canonicalBlockHash: blockHash, confirmations: 5, finalizedBlockNumber: 100n
    }
  };
}

describe("cross-chain swap destination evidence", () => {
  it("binds an Across Base deposit to an Arbitrum fill and received USDC", () => {
    const sourcePool = "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64";
    const destinationPool = "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A";
    const destinationToken = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
    const addressWord = (address: string) => padHex(address as `0x${string}`, { size: 32 });
    const sourceAbi = parseAbiItem("event FundsDeposited(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 indexed destinationChainId, uint256 indexed depositId, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 indexed depositor, bytes32 recipient, bytes32 exclusiveRelayer, bytes message)");
    const destinationAbi = parseAbiItem("event FilledRelay(bytes32 inputToken, bytes32 outputToken, uint256 inputAmount, uint256 outputAmount, uint256 repaymentChainId, uint256 indexed originChainId, uint256 indexed depositId, uint32 fillDeadline, uint32 exclusivityDeadline, bytes32 exclusiveRelayer, bytes32 indexed relayer, bytes32 depositor, bytes32 recipient, bytes32 messageHash, (bytes32 updatedRecipient, bytes32 updatedMessageHash, uint256 updatedOutputAmount, uint8 fillType) relayExecutionInfo)");
    const source = fixture();
    source.expected.sourceChainId = 8453;
    source.expected.destinationChainId = 42161;
    source.expected.destinationToken = destinationToken;
    source.expected.across = { sourceToken: token, sourceAmountRaw: "1000000", depositor: sender };
    source.expected.bridgeLink = undefined;
    source.provider.destinationChainId = 42161;
    source.sourceObserved.call.chainId = 8453;
    source.sourceObserved.call.from = sender;
    source.sourceObserved.receipt!.logs = [{ address: sourcePool,
      topics: encodeEventTopics({ abi: [sourceAbi], eventName: "FundsDeposited", args: { destinationChainId: 42161n, depositId: 42n, depositor: addressWord(sender) } }).map(String),
      data: encodeAbiParameters(sourceAbi.inputs.filter((field) => !("indexed" in field && field.indexed)) as AbiParameter[], [addressWord(token), addressWord(destinationToken), 1000000n, 990000n, 1, 2000000000, 0, addressWord(recipient), addressWord("0x0000000000000000000000000000000000000000"), "0x"]) }];
    source.observed.call.chainId = 42161;
    source.observed.receipt!.logs = [{ address: destinationPool,
      topics: encodeEventTopics({ abi: [destinationAbi], eventName: "FilledRelay", args: { originChainId: 8453n, depositId: 42n, relayer: addressWord(sender) } }).map(String),
      data: encodeAbiParameters(destinationAbi.inputs.filter((field) => !("indexed" in field && field.indexed)) as AbiParameter[], [addressWord(token), addressWord(destinationToken), 1000000n, 990000n, 42161n, 2000000000, 0, addressWord("0x0000000000000000000000000000000000000000"), addressWord(sender), addressWord(recipient), `0x${"0".repeat(64)}`, [addressWord(recipient), `0x${"0".repeat(64)}`, 990000n, 0]]) },
      { address: destinationToken, topics: encodeEventTopics({ abi: erc20Abi, eventName: "Transfer", args: { from: destinationPool, to: recipient } }).map(String),
        data: `0x${(990000n).toString(16).padStart(64, "0")}` }];
    expect(verifySwapDestination(source)).toEqual({ status: "complete" });
    source.expected.across.sourceAmountRaw = "1000001";
    expect(verifySwapDestination(source)).toEqual({ status: "inconsistent", reason: "across_relay_mismatch" });
    source.expected.across.sourceAmountRaw = "1000000";
    source.expected.recipient = sender;
    expect(verifySwapDestination(source)).not.toEqual({ status: "complete" });
    source.expected.recipient = recipient;
    source.observed.receipt!.logs[0].topics[2] = `0x${"9".repeat(64)}`;
    expect(verifySwapDestination(source)).not.toEqual({ status: "complete" });
  });

  it("never treats an Across deposit ID alone as generic bridge settlement proof", () => {
    const input = fixture();
    input.expected.bridgeLink = { sourceContract: "0x09aea4b2242abC8bb4BB78D537A67a245A7bEC64",
      sourceEventTopic: "0x32ed1a409ef04c7b0227189c3a103dc5ac10e775a15b785dcc510201f7c25ad3",
      destinationContract: "0xe35e9842fceaCA96570B734083f4a58e8F7C5f2A",
      destinationEventTopic: "0x44b559f101f8fbcc8a0ea43fa91a05a729a5ea6e14a7c75aa750374690137208", messageTopicIndex: 2 };
    const depositId = `0x${"a".repeat(64)}`;
    input.sourceObserved.receipt!.logs[0] = { address: input.expected.bridgeLink.sourceContract,
      topics: [input.expected.bridgeLink.sourceEventTopic, `0x${"0".repeat(64)}`, depositId], data: "0x" };
    input.observed.receipt!.logs[0] = { address: input.expected.bridgeLink.destinationContract,
      topics: [input.expected.bridgeLink.destinationEventTopic, `0x${"0".repeat(64)}`, depositId], data: "0x" };
    expect(verifySwapDestination(input)).toEqual({ status: "pending", reason: "bridge_link_unverified" });
  });
  it("confirms only a source-bound, finalized destination transfer above the reviewed minimum", () => {
    expect(verifySwapDestination(fixture())).toEqual({ status: "complete" });
  });

  it("never accepts provider DONE without independent destination evidence", () => {
    const input: SwapDestinationEvidence = fixture();
    input.observed = { status: "pending" };
    expect(verifySwapDestination(input)).toEqual({ status: "pending", reason: "destination_unavailable" });
  });

  it("never closes on an unrelated destination transfer without matching bridge message evidence", () => {
    const missing = fixture();
    missing.sourceObserved.receipt!.logs = [];
    expect(verifySwapDestination(missing)).toEqual({ status: "pending", reason: "bridge_link_unverified" });
    const unrelated = fixture();
    unrelated.observed.receipt!.logs[0].topics[1] = `0x${"9".repeat(64)}`;
    expect(verifySwapDestination(unrelated)).toEqual({ status: "inconsistent", reason: "bridge_message_mismatch" });
  });

  it("rejects a provider status bound to another source hash", () => {
    const input = fixture();
    input.provider.sourceHash = `0x${"f".repeat(64)}`;
    expect(verifySwapDestination(input)).toEqual({ status: "inconsistent", reason: "source_hash" });
  });

  it("rejects source receipt on another chain or hash", () => {
    const wrongChain = fixture();
    wrongChain.sourceObserved.call.chainId = 10;
    expect(verifySwapDestination(wrongChain)).toEqual({ status: "inconsistent", reason: "source_receipt" });
    const wrongHash = fixture();
    wrongHash.sourceObserved.receipt!.transactionHash = `0x${"8".repeat(64)}`;
    expect(verifySwapDestination(wrongHash)).toEqual({ status: "inconsistent", reason: "source_receipt" });
  });

  it.each(["PARTIAL", "REFUNDED", "FAILED", "PENDING"] as const)("keeps provider %s distinct from completion", (status) => {
    const input = fixture();
    input.provider.status = status;
    expect(verifySwapDestination(input).status).not.toBe("complete");
  });

  it("requires a matching destination chain and transaction hash", () => {
    const wrongChain = fixture();
    wrongChain.provider.destinationChainId = 1;
    expect(verifySwapDestination(wrongChain)).toEqual({ status: "inconsistent", reason: "destination_chain" });
    const wrongHash = fixture();
    wrongHash.observed.receipt!.transactionHash = `0x${"d".repeat(64)}`;
    expect(verifySwapDestination(wrongHash)).toEqual({ status: "inconsistent", reason: "destination_hash" });
  });

  it("keeps the destination pending until its receipt is canonical and finalized", () => {
    const unfinalized = fixture();
    unfinalized.observed.finalizedBlockNumber = 99n;
    expect(verifySwapDestination(unfinalized)).toEqual({ status: "pending", reason: "finality" });
    const reorg = fixture();
    reorg.observed.canonicalBlockHash = `0x${"e".repeat(64)}`;
    expect(verifySwapDestination(reorg)).toEqual({ status: "reorged", reason: "destination_block" });
    const changedAfterObservation = fixture();
    changedAfterObservation.expected.previousBlockHash = `0x${"d".repeat(64)}`;
    expect(verifySwapDestination(changedAfterObservation)).toEqual({ status: "reorged", reason: "destination_block" });
  });

  it("does not complete on an unfinalized or reorged source bridge event", () => {
    const unfinalized = fixture();
    unfinalized.sourceObserved.finalizedBlockNumber = 99n;
    expect(verifySwapDestination(unfinalized)).toEqual({ status: "pending", reason: "source_finality" });
    const reorg = fixture();
    reorg.sourceObserved.canonicalBlockHash = `0x${"7".repeat(64)}`;
    expect(verifySwapDestination(reorg)).toEqual({ status: "reorged", reason: "source_block" });
  });

  it("does not complete a reverted destination transaction", () => {
    const input = fixture();
    input.observed.receipt!.status = "reverted";
    expect(verifySwapDestination(input)).toEqual({ status: "failed", reason: "destination_reverted" });
  });

  it("does not accept the wrong recipient, token or insufficient amount", () => {
    const wrongRecipient = fixture();
    wrongRecipient.expected.recipient = sender;
    expect(verifySwapDestination(wrongRecipient)).toEqual({ status: "inconsistent", reason: "destination_effect" });
    const wrongToken = fixture();
    wrongToken.expected.destinationToken = bridge;
    expect(verifySwapDestination(wrongToken)).toEqual({ status: "inconsistent", reason: "destination_effect" });
    const insufficient = fixture();
    insufficient.expected.minimumAmountRaw = "1000001";
    expect(verifySwapDestination(insufficient)).toEqual({ status: "partial", reason: "minimum_not_met", amountRaw: "1000000" });
  });

  it("does not claim an internal native payout without separate native transfer evidence", () => {
    const input = fixture();
    input.expected.destinationToken = null;
    expect(verifySwapDestination(input)).toEqual({ status: "pending", reason: "native_effect_unavailable" });
  });

  it("confirms a directly observed native payout to the bound recipient", () => {
    const input = fixture();
    input.expected.destinationToken = null;
    input.observed.call = { chainId: 8453, from: bridge, to: recipient, value: "1000000", data: "0x" };
    expect(verifySwapDestination(input)).toEqual({ status: "complete" });
  });
});
