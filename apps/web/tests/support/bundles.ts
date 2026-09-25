import { concatHex, encodeAbiParameters, encodeEventTopics, encodeFunctionData, numberToHex, pad, parseAbi, parseAbiItem } from "viem";
import type { Log } from "@/lib/actions/user-operation";

type Call = { to: `0x${string}`; value: bigint; data: `0x${string}` };

export const bundler = "0x9999999999999999999999999999999999999999";
const kernel = parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]);
const v07 = parseAbi([
  "struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }",
  "function handleOps(PackedUserOperation[] ops, address beneficiary)"
]);
export const kernelMode = (callType: string, execType = "00") => `0x${callType}${execType}${"00".repeat(30)}` as `0x${string}`;

/** Kernel v3 `execute` calldata for a batch of calls. */
export function kernelBatch(calls: Call[], execType = "00") {
  const execution = encodeAbiParameters([{ type: "tuple[]", components: [
    { name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }] }],
  [calls.map((call) => ({ target: call.to, value: call.value, callData: call.data }))]);
  return encodeFunctionData({ abi: kernel, functionName: "execute", args: [kernelMode("01", execType), execution] });
}

/** Kernel v3 `execute` calldata for one call. */
export function kernelSingle(to: `0x${string}`, value: bigint, data: `0x${string}`) {
  return encodeFunctionData({ abi: kernel, functionName: "execute", args: [kernelMode("00"), concatHex([to, pad(numberToHex(value), { size: 32 }), data])] });
}

/** EntryPoint v0.7 `handleOps` calldata. */
export function handleOpsV07(ops: Array<{ sender: `0x${string}`; callData: `0x${string}` }>) {
  return encodeFunctionData({ abi: v07, functionName: "handleOps", args: [ops.map((op, nonce) => ({
    sender: op.sender, nonce: BigInt(nonce), initCode: "0x" as const, callData: op.callData, accountGasLimits: pad("0x01"),
    preVerificationGas: 1n, gasFees: pad("0x01"), paymasterAndData: "0x" as const, signature: "0x" as const
  })), bundler] });
}

/** An EntryPoint `BeforeExecution` or `UserOperationEvent` log. */
export function entryLog(entryPoint: string, event: "before" | { sender: `0x${string}`; success: boolean }): Log {
  if (event === "before") return { address: entryPoint, topics: encodeEventTopics({ abi: [parseAbiItem("event BeforeExecution()")] }) as string[], data: "0x" };
  const abi = [parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)")];
  return { address: entryPoint, topics: encodeEventTopics({ abi, eventName: "UserOperationEvent",
    args: { userOpHash: pad("0x01"), sender: event.sender, paymaster: bundler } }) as string[],
  data: encodeAbiParameters([{ type: "uint256" }, { type: "bool" }, { type: "uint256" }, { type: "uint256" }], [0n, event.success, 1n, 1n]) };
}

/** An ERC-20 `Transfer` log. */
export function transferLog(token: string, from: `0x${string}`, to: `0x${string}`, value: bigint): Log {
  const abi = [parseAbiItem("event Transfer(address indexed from, address indexed to, uint256 value)")];
  return { address: token, topics: encodeEventTopics({ abi, eventName: "Transfer", args: { from, to } }) as string[],
    data: encodeAbiParameters([{ type: "uint256" }], [value]) };
}
