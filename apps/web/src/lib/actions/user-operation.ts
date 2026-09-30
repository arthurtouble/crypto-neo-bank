import { decodeAbiParameters, decodeEventLog, decodeFunctionData, hexToBigInt, parseAbi, parseAbiItem, slice, sliceHex, size } from "viem";
import { sameAddress, type Call } from "./types";

// ERC-4337 EntryPoints. Kernel v3 uses v0.7; Coinbase Smart Wallet uses v0.6.
// EIP-7702 accounts, such as Privy's upgraded embedded wallets, may use v0.8,
// which keeps v0.7's handleOps encoding and events.
export const ENTRY_POINT_V08 = "0x4337084d9e255ff0702461cf8895ce9e3b5ff108";
export const ENTRY_POINT_V07 = "0x0000000071727de22e5e9d8baf0edac6f37da032";
export const ENTRY_POINT_V06 = "0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789";

const entryPointV07 = parseAbi([
  "struct PackedUserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; bytes32 accountGasLimits; uint256 preVerificationGas; bytes32 gasFees; bytes paymasterAndData; bytes signature; }",
  "function handleOps(PackedUserOperation[] ops, address beneficiary)"
]);
const entryPointV06 = parseAbi([
  "struct UserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; uint256 callGasLimit; uint256 verificationGasLimit; uint256 preVerificationGas; uint256 maxFeePerGas; uint256 maxPriorityFeePerGas; bytes paymasterAndData; bytes signature; }",
  "function handleOps(UserOperation[] ops, address beneficiary)"
]);
const userOperationEvent = parseAbiItem("event UserOperationEvent(bytes32 indexed userOpHash, address indexed sender, address indexed paymaster, uint256 nonce, bool success, uint256 actualGasCost, uint256 actualGasUsed)");
const beforeExecution = parseAbiItem("event BeforeExecution()");

// Account encodings Aura can decode exactly.
const kernelV3 = parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]);
const KERNEL_EXECUTE_USER_OP = "0x8dd7712f";
const coinbaseSmartWallet = parseAbi([
  "struct Call { address target; uint256 value; bytes data; }",
  "function execute(address target, uint256 value, bytes data)",
  "function executeBatch(Call[] calls)"
]);

export type Log = { address: string; topics: string[]; data: string };

type OperationEvidence =
  | { status: "found"; calls: Call[]; success: boolean; logs: Log[] }
  | { status: "unrecognized"; reason: string };

function normalizeCall(target: string, value: bigint, data: string): Call {
  return { to: target.toLowerCase() as `0x${string}`, value: value.toString(), data: data.toLowerCase() as `0x${string}` };
}

/** Decode an account's `callData` into the calls it will execute, or null when the encoding is not one Aura knows. */
export function decodeAccountCalls(callData: `0x${string}`): Call[] | null {
  let data = callData;
  if (data.toLowerCase().startsWith(KERNEL_EXECUTE_USER_OP)) data = slice(data, 4);
  try {
    const decoded = decodeFunctionData({ abi: kernelV3, data });
    const mode = decoded.args[0];
    const callType = mode.slice(2, 4);
    const execType = mode.slice(4, 6);
    // Only the default exec type reverts the whole operation when a call fails.
    if (execType !== "00") return null;
    const execution = decoded.args[1];
    if (callType === "00") {
      if (size(execution) < 52) return null;
      return [normalizeCall(sliceHex(execution, 0, 20), hexToBigInt(sliceHex(execution, 20, 52)), size(execution) === 52 ? "0x" : sliceHex(execution, 52))];
    }
    if (callType === "01") {
      const [executions] = decodeAbiParameters([{ type: "tuple[]", components: [
        { name: "target", type: "address" }, { name: "value", type: "uint256" }, { name: "callData", type: "bytes" }
      ] }], execution);
      return executions.map((item) => normalizeCall(item.target, item.value, item.callData));
    }
    return null;
  } catch { /* Not a Kernel v3 execute call. */ }
  try {
    const decoded = decodeFunctionData({ abi: coinbaseSmartWallet, data });
    if (decoded.functionName === "execute") return [normalizeCall(decoded.args[0], decoded.args[1], decoded.args[2])];
    return decoded.args[0].map((item) => normalizeCall(item.target, item.value, item.data));
  } catch { return null; }
}

function decodeHandleOps(input: `0x${string}`): Array<{ sender: string; callData: `0x${string}` }> | null {
  for (const abi of [entryPointV07, entryPointV06]) {
    try {
      const decoded = decodeFunctionData({ abi, data: input });
      return decoded.args[0].map((op) => ({ sender: op.sender, callData: op.callData }));
    } catch { /* Try the other EntryPoint version. */ }
  }
  return null;
}

type Transaction = { from: string; to: string; value: string; data: string };

/**
 * Find the wallet's operation in a transaction and return its decoded calls,
 * its success flag, and only the logs its execution emitted.
 */
export function readWalletOperation(wallet: string, transaction: Transaction, logs: readonly Log[], receiptSuccess: boolean): OperationEvidence {
  // A plain transaction signed by the wallet itself (an EOA wallet). Kept for
  // accounts that have not been upgraded; it carries exactly one call.
  if (sameAddress(transaction.from, wallet)) {
    return { status: "found", calls: [normalizeCall(transaction.to, BigInt(transaction.value), transaction.data)], success: receiptSuccess, logs: [...logs] };
  }
  const entryPoint = transaction.to.toLowerCase();
  if (entryPoint !== ENTRY_POINT_V08 && entryPoint !== ENTRY_POINT_V07 && entryPoint !== ENTRY_POINT_V06) return { status: "unrecognized", reason: "not_entry_point" };
  const ops = decodeHandleOps(transaction.data as `0x${string}`);
  if (!ops) return { status: "unrecognized", reason: "not_handle_ops" };
  const mine = ops.filter((op) => sameAddress(op.sender, wallet));
  if (mine.length !== 1) return { status: "unrecognized", reason: mine.length ? "multiple_operations" : "operation_missing" };
  const calls = decodeAccountCalls(mine[0].callData);
  if (!calls) return { status: "unrecognized", reason: "account_encoding" };

  // Execution logs of operation i sit between BeforeExecution (or operation
  // i-1's UserOperationEvent) and operation i's UserOperationEvent.
  let start = -1;
  for (let index = 0; index < logs.length; index++) {
    const log = logs[index];
    if (!sameAddress(log.address, entryPoint)) continue;
    const topics = log.topics as [`0x${string}`, ...`0x${string}`[]];
    try {
      decodeEventLog({ abi: [beforeExecution], data: log.data as `0x${string}`, topics, strict: true });
      start = index;
      continue;
    } catch { /* Not BeforeExecution. */ }
    try {
      const event = decodeEventLog({ abi: [userOperationEvent], data: log.data as `0x${string}`, topics, strict: true });
      if (start < 0) return { status: "unrecognized", reason: "log_order" };
      if (sameAddress(event.args.sender, wallet)) {
        return { status: "found", calls, success: event.args.success, logs: logs.slice(start + 1, index) };
      }
      start = index;
    } catch { /* Another EntryPoint event. */ }
  }
  return { status: "unrecognized", reason: "operation_event_missing" };
}
