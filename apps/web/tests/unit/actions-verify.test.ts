import { describe, expect, it } from "vitest";
import { encodeAbiParameters, encodeEventTopics, encodeFunctionData, erc20Abi, parseAbiItem } from "viem";
import type { ChainObservation } from "@/lib/actions/chain";
import type { LifiStatusCorroboration } from "@/lib/actions/lifi-status";
import { ENTRY_POINT_V07, type Log } from "@/lib/actions/user-operation";
import { effectSchema } from "@/lib/actions/types";
import { verifyAction, type VerifiableAction } from "@/lib/actions/verify";
import { bundler, entryLog, handleOpsV07, kernelBatch, transferLog } from "../support/bundles";

const wallet = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const arbUsdc = "0xaf88d065e77c8cc2239327c5edb3a432268e5831";
const diamond = "0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae";
const hash = `0x${"a".repeat(64)}`;
const destinationHash = `0x${"d".repeat(64)}`;
const block = `0x${"b".repeat(64)}`;
const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 5n] });
const calls = [{ to: usdc, value: "0", data: transfer }] as VerifiableAction["calls"];

const send: VerifiableAction = { chainId: 8453, walletAddress: wallet, calls, transactionHash: hash,
  effects: [{ type: "erc20_transfer", token: usdc, to: recipient, amountRaw: "5" }] };

function observed(input: { data?: `0x${string}`; logs?: Log[]; success?: boolean; confirmations?: number; finalized?: bigint;
  status?: "success" | "reverted"; txHash?: string }): ChainObservation {
  const data = input.data ?? handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: transfer }]) }]);
  const logs = input.logs ?? [entryLog(ENTRY_POINT_V07, "before"), transferLog(usdc, wallet, recipient, 5n),
    entryLog(ENTRY_POINT_V07, { sender: wallet, success: input.success ?? true })];
  return { status: "found", call: { chainId: 8453, from: bundler, to: ENTRY_POINT_V07, value: "0", data }, blockHash: block,
    canonicalBlockHash: block, confirmations: input.confirmations ?? 5, finalizedBlockNumber: input.finalized ?? 100n,
    receipt: { status: input.status ?? "success", transactionHash: input.txHash ?? hash, blockHash: block, blockNumber: 100n, logs } };
}

const observe = (result: ChainObservation) => async () => result;

describe("verifying an action from chain evidence", () => {
  it("confirms a final, successful operation whose calls and effects match", async () => {
    expect(await verifyAction(send, { observe: observe(observed({})) })).toEqual({ status: "confirmed" });
  });

  it("waits for the transaction, the receipt, and finality", async () => {
    expect(await verifyAction(send, { observe: observe({ status: "pending" }) })).toMatchObject({ status: "pending", reason: "transaction_unavailable" });
    expect(await verifyAction(send, { observe: observe({ ...observed({}), receipt: null } as ChainObservation) })).toMatchObject({ status: "pending", reason: "receipt_unavailable" });
    expect(await verifyAction(send, { observe: observe(observed({ confirmations: 0 })) })).toMatchObject({ status: "pending", reason: "confirmations" });
    expect(await verifyAction(send, { observe: observe({ ...observed({}), canonicalBlockHash: `0x${"e".repeat(64)}` } as ChainObservation) }))
      .toMatchObject({ status: "pending", reason: "reorg" });
  });

  it("shows a matching operation as settling until its block is final, and lets only finality fail one", async () => {
    expect(await verifyAction(send, { observe: observe(observed({ finalized: 99n })) })).toEqual({ status: "settling", reason: "finality" });
    const other = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 6n] });
    const data = handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: other }]) }]);
    expect(await verifyAction(send, { observe: observe(observed({ data, finalized: 99n })) })).toEqual({ status: "pending", reason: "finality" });
    expect(await verifyAction(send, { observe: observe(observed({ success: false, finalized: 99n })) })).toEqual({ status: "pending", reason: "finality" });
  });

  it("fails an operation that ran different calls than Aura prepared", async () => {
    const other = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [recipient, 6n] });
    const data = handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: other }]) }]);
    expect(await verifyAction(send, { observe: observe(observed({ data })) })).toEqual({ status: "failed", reason: "calls_mismatch" });
  });

  it("fails a reverted bundle, a reverted operation, and a missing effect", async () => {
    expect(await verifyAction(send, { observe: observe(observed({ status: "reverted" })) })).toEqual({ status: "failed", reason: "transaction_reverted" });
    expect(await verifyAction(send, { observe: observe(observed({ success: false })) })).toEqual({ status: "failed", reason: "operation_reverted" });
    const logs = [entryLog(ENTRY_POINT_V07, "before"), transferLog(usdc, wallet, recipient, 4n), entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })];
    expect(await verifyAction(send, { observe: observe(observed({ logs })) })).toEqual({ status: "failed", reason: "effect_missing_erc20_transfer" });
  });

  it("ignores effects emitted by another wallet's operation in the same bundle", async () => {
    const other = "0x3333333333333333333333333333333333333333";
    const data = handleOpsV07([{ sender: other, callData: kernelBatch([{ to: usdc, value: 0n, data: transfer }]) },
      { sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: transfer }]) }]);
    const logs = [entryLog(ENTRY_POINT_V07, "before"), transferLog(usdc, wallet, recipient, 5n), entryLog(ENTRY_POINT_V07, { sender: other, success: true }),
      entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })];
    expect(await verifyAction(send, { observe: observe(observed({ data, logs })) })).toEqual({ status: "failed", reason: "effect_missing_erc20_transfer" });
  });

  it("fails a hash that is not an operation of this wallet", async () => {
    const data = handleOpsV07([{ sender: recipient, callData: kernelBatch([{ to: usdc, value: 0n, data: transfer }]) }]);
    expect(await verifyAction(send, { observe: observe(observed({ data })) })).toEqual({ status: "failed", reason: "operation_operation_missing" });
  });
});

describe("verifying cross-chain delivery", () => {
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [diamond, 1_000_000n] });
  const route: VerifiableAction = { chainId: 8453, walletAddress: wallet, transactionHash: hash,
    calls: [{ to: usdc, value: "0", data: approve }, { to: diamond, value: "0", data: "0x12345678" }],
    effects: [{ type: "erc20_debit", token: usdc, amountRaw: "1000000" },
      { type: "delivery", tool: "across", destinationChainId: 42161, token: arbUsdc, to: wallet, minimumRaw: "990000" }] };
  const source = observed({
    data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: approve }, { to: diamond, value: 0n, data: "0x12345678" }]) }]),
    logs: [entryLog(ENTRY_POINT_V07, "before"), transferLog(usdc, wallet, diamond, 1_000_000n), entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })]
  });
  const destination = (credited: bigint): ChainObservation => ({ status: "found", blockHash: block, canonicalBlockHash: block, confirmations: 5, finalizedBlockNumber: 100n,
    call: { chainId: 42161, from: bundler, to: arbUsdc, value: "0", data: "0x" },
    receipt: { status: "success", transactionHash: destinationHash, blockHash: block, blockNumber: 100n, logs: [transferLog(arbUsdc, bundler, wallet, credited)] } });
  const byChain = (credited: bigint) => async (chainId: number) => chainId === 8453 ? source : destination(credited);
  const lifi = (status: LifiStatusCorroboration["status"], destinationTransaction: string | null = destinationHash) => async () =>
    ({ status, sourceHash: hash, destinationChainId: 42161, destinationHash: destinationTransaction, toolId: "across", substatus: null });

  it("settles only once LI.FI reports delivery and the destination receipt credits the minimum", async () => {
    expect(await verifyAction(route, { observe: byChain(995_000n), lifiStatus: lifi("PENDING", null) })).toMatchObject({ status: "settling", reason: "awaiting_delivery" });
    expect(await verifyAction(route, { observe: byChain(995_000n), lifiStatus: lifi("DONE") })).toEqual({ status: "confirmed", destinationHash });
    expect(await verifyAction(route, { observe: byChain(980_000n), lifiStatus: lifi("DONE") })).toEqual({ status: "failed", reason: "delivery_below_minimum" });
  });

  it("reports refunds and failed deliveries without claiming success", async () => {
    expect(await verifyAction(route, { observe: byChain(0n), lifiStatus: lifi("REFUNDED", null) })).toEqual({ status: "failed", reason: "refunded" });
    expect(await verifyAction(route, { observe: byChain(0n), lifiStatus: lifi("FAILED", null) })).toEqual({ status: "failed", reason: "delivery_failed" });
    expect(await verifyAction(route, { observe: byChain(0n), lifiStatus: async () => { throw new Error("down"); } })).toMatchObject({ status: "settling" });
  });
});

describe("verifying a card allowance", () => {
  const spender = "0x5555555555555555555555555555555555555555";
  const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 50_000_000n] });
  const allowance: VerifiableAction = { chainId: 8453, walletAddress: wallet, transactionHash: hash, calls: [{ to: usdc, value: "0", data: approve }],
    effects: [{ type: "erc20_approval", token: usdc, spender, amountRaw: "50000000" }] };
  const approval = (owner: `0x${string}`, value: bigint): Log => {
    const abi = [parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)")];
    return { address: usdc, topics: encodeEventTopics({ abi, eventName: "Approval", args: { owner, spender } }) as string[],
      data: encodeAbiParameters([{ type: "uint256" }], [value]) };
  };
  const withApproval = (log: Log) => observed({ data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: approve }]) }]),
    logs: [entryLog(ENTRY_POINT_V07, "before"), log, entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })] });

  it("confirms only an Approval log from the account to the card contract for the exact amount", async () => {
    expect(await verifyAction(allowance, { observe: observe(withApproval(approval(wallet, 50_000_000n))) })).toEqual({ status: "confirmed" });
    expect(await verifyAction(allowance, { observe: observe(withApproval(approval(wallet, 1n))) })).toMatchObject({ status: "failed" });
    expect(await verifyAction(allowance, { observe: observe(withApproval(approval(recipient, 50_000_000n))) })).toMatchObject({ status: "failed" });
  });

  it("confirms turning spending off only when the Approval event value is exactly 0, from the account to the card contract", async () => {
    const zero = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [spender, 0n] });
    const off: VerifiableAction = { ...allowance, calls: [{ to: usdc, value: "0", data: zero }],
      effects: [effectSchema.parse({ type: "erc20_approval", token: usdc, spender, amountRaw: "0" })] };
    const offWith = (log: Log) => observed({ data: handleOpsV07([{ sender: wallet, callData: kernelBatch([{ to: usdc, value: 0n, data: zero }]) }]),
      logs: [entryLog(ENTRY_POINT_V07, "before"), log, entryLog(ENTRY_POINT_V07, { sender: wallet, success: true })] });
    const other = "0x6666666666666666666666666666666666666666";
    const otherApproval: Log = { ...approval(wallet, 0n),
      topics: encodeEventTopics({ abi: [parseAbiItem("event Approval(address indexed owner, address indexed spender, uint256 value)")], eventName: "Approval", args: { owner: wallet, spender: other } }) as string[] };
    expect(await verifyAction(off, { observe: observe(offWith(approval(wallet, 0n))) })).toEqual({ status: "confirmed" });
    expect(await verifyAction(off, { observe: observe(offWith(approval(wallet, 1n))) })).toEqual({ status: "failed", reason: "effect_missing_erc20_approval" });
    expect(await verifyAction(off, { observe: observe(offWith(approval(recipient, 0n))) })).toEqual({ status: "failed", reason: "effect_missing_erc20_approval" });
    expect(await verifyAction(off, { observe: observe(offWith(otherApproval)) })).toEqual({ status: "failed", reason: "effect_missing_erc20_approval" });
    // An approval on another token isn't the card's USDC allowance.
    expect(await verifyAction(off, { observe: observe(offWith({ ...approval(wallet, 0n), address: arbUsdc })) })).toEqual({ status: "failed", reason: "effect_missing_erc20_approval" });
  });

  it("accepts a zero amount only for an approval", () => {
    expect(effectSchema.safeParse({ type: "erc20_approval", token: usdc, spender, amountRaw: "0" }).success).toBe(true);
    for (const effect of [{ type: "erc20_transfer", token: usdc, to: recipient, amountRaw: "0" }, { type: "erc20_debit", token: usdc, amountRaw: "0" },
      { type: "erc20_credit_min", token: usdc, to: recipient, minimumRaw: "0" }, { type: "erc20_approval", token: usdc, spender, amountRaw: "00" },
      { type: "erc20_approval", token: usdc, spender, amountRaw: "-1" }]) expect(effectSchema.safeParse(effect).success).toBe(false);
  });
});
