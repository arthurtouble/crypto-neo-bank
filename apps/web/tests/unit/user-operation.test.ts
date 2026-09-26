import { describe, expect, it } from "vitest";
import { concatHex, encodeFunctionData, erc20Abi, pad, parseAbi } from "viem";
import { decodeAccountCalls, ENTRY_POINT_V06, ENTRY_POINT_V07, ENTRY_POINT_V08, readWalletOperation, type Log } from "@/lib/actions/user-operation";
import { bundler, entryLog, handleOpsV07, kernelBatch, kernelMode as mode, kernelSingle } from "../support/bundles";

const wallet = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const pool = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
const approve = encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [pool, 5n] });
const transfer = encodeFunctionData({ abi: erc20Abi, functionName: "transfer", args: [other, 5n] });

const kernel = parseAbi(["function execute(bytes32 mode, bytes executionCalldata)"]);
const coinbase = parseAbi(["struct Call { address target; uint256 value; bytes data; }", "function executeBatch(Call[] calls)", "function execute(address target, uint256 value, bytes data)"]);
const v06 = parseAbi([
  "struct UserOperation { address sender; uint256 nonce; bytes initCode; bytes callData; uint256 callGasLimit; uint256 verificationGasLimit; uint256 preVerificationGas; uint256 maxFeePerGas; uint256 maxPriorityFeePerGas; bytes paymasterAndData; bytes signature; }",
  "function handleOps(UserOperation[] ops, address beneficiary)"
]);

const tokenLog = (marker: string): Log => ({ address: usdc, topics: [pad(`0x${marker}`)], data: "0x" });

describe("smart wallet account encodings", () => {
  it("decodes Kernel v3 batch and single executions", () => {
    expect(decodeAccountCalls(kernelBatch([{ to: usdc, value: 0n, data: approve }, { to: pool, value: 0n, data: "0x1234" }]))).toEqual([
      { to: usdc, value: "0", data: approve }, { to: pool, value: "0", data: "0x1234" }
    ]);
    expect(decodeAccountCalls(kernelSingle(other, 7n, "0x"))).toEqual([{ to: other, value: "7", data: "0x" }]);
    expect(decodeAccountCalls(kernelSingle(usdc, 0n, transfer))).toEqual([{ to: usdc, value: "0", data: transfer }]);
  });

  it("decodes a Kernel call wrapped in executeUserOp", () => {
    const inner = kernelSingle(other, 1n, "0x");
    expect(decodeAccountCalls(`0x8dd7712f${inner.slice(2)}`)).toEqual([{ to: other, value: "1", data: "0x" }]);
  });

  it("rejects Kernel try-mode and delegatecall executions", () => {
    expect(decodeAccountCalls(kernelBatch([{ to: usdc, value: 0n, data: approve }], "01"))).toBeNull();
    expect(decodeAccountCalls(encodeFunctionData({ abi: kernel, functionName: "execute", args: [mode("ff"), concatHex([other, "0x1234"])] }))).toBeNull();
  });

  it("decodes Coinbase Smart Wallet execute and executeBatch", () => {
    expect(decodeAccountCalls(encodeFunctionData({ abi: coinbase, functionName: "executeBatch", args: [[{ target: usdc, value: 0n, data: transfer }]] })))
      .toEqual([{ to: usdc, value: "0", data: transfer }]);
    expect(decodeAccountCalls(encodeFunctionData({ abi: coinbase, functionName: "execute", args: [other, 3n, "0x"] })))
      .toEqual([{ to: other, value: "3", data: "0x" }]);
  });

  it("does not guess unknown encodings", () => {
    expect(decodeAccountCalls("0xdeadbeef")).toBeNull();
  });
});

describe("reading the wallet's operation from a bundle", () => {
  const mineCalls = kernelBatch([{ to: usdc, value: 0n, data: transfer }]);
  const theirs = kernelSingle(other, 1n, "0x");

  it("returns only the logs of the wallet's own execution", () => {
    const logs = [tokenLog("aa"), entryLog(ENTRY_POINT_V07, "before"), tokenLog("01"), entryLog(ENTRY_POINT_V07, { sender: other, success: true }),
      tokenLog("02"), entryLog(ENTRY_POINT_V07, { sender: wallet, success: true }), tokenLog("03")];
    const input = handleOpsV07([{ sender: other, callData: theirs }, { sender: wallet, callData: mineCalls }]);
    const result = readWalletOperation(wallet, { from: bundler, to: ENTRY_POINT_V07, value: "0", data: input }, logs, true);
    expect(result).toEqual({ status: "found", success: true, calls: [{ to: usdc, value: "0", data: transfer }], logs: [tokenLog("02")] });
  });

  it("reports an operation that failed inside a successful bundle", () => {
    const logs = [entryLog(ENTRY_POINT_V07, "before"), entryLog(ENTRY_POINT_V07, { sender: wallet, success: false })];
    const input = handleOpsV07([{ sender: wallet, callData: mineCalls }]);
    expect(readWalletOperation(wallet, { from: bundler, to: ENTRY_POINT_V07, value: "0", data: input }, logs, true))
      .toMatchObject({ status: "found", success: false, logs: [] });
  });

  it("reads an EIP-7702 account's operation through EntryPoint v0.8, where the sender is the upgraded wallet itself", () => {
    const logs = [entryLog(ENTRY_POINT_V08, "before"), tokenLog("01"), entryLog(ENTRY_POINT_V08, { sender: wallet, success: true })];
    const input = handleOpsV07([{ sender: wallet, callData: mineCalls }]);
    expect(readWalletOperation(wallet, { from: bundler, to: ENTRY_POINT_V08, value: "0", data: input }, logs, true))
      .toEqual({ status: "found", success: true, calls: [{ to: usdc, value: "0", data: transfer }], logs: [tokenLog("01")] });
  });

  it("reads EntryPoint v0.6 bundles", () => {
    const callData = encodeFunctionData({ abi: coinbase, functionName: "executeBatch", args: [[{ target: usdc, value: 0n, data: transfer }]] });
    const input = encodeFunctionData({ abi: v06, functionName: "handleOps", args: [[{ sender: wallet, nonce: 0n, initCode: "0x", callData,
      callGasLimit: 1n, verificationGasLimit: 1n, preVerificationGas: 1n, maxFeePerGas: 1n, maxPriorityFeePerGas: 1n, paymasterAndData: "0x", signature: "0x" }], bundler] });
    const logs = [entryLog(ENTRY_POINT_V06, "before"), tokenLog("05"), entryLog(ENTRY_POINT_V06, { sender: wallet, success: true })];
    expect(readWalletOperation(wallet, { from: bundler, to: ENTRY_POINT_V06, value: "0", data: input }, logs, true))
      .toMatchObject({ status: "found", success: true, logs: [tokenLog("05")] });
  });

  it("accepts a plain transaction signed by the wallet itself", () => {
    expect(readWalletOperation(wallet, { from: wallet, to: usdc, value: "0", data: transfer }, [tokenLog("06")], true))
      .toEqual({ status: "found", success: true, calls: [{ to: usdc, value: "0", data: transfer }], logs: [tokenLog("06")] });
  });

  it("refuses transactions it cannot attribute to exactly one wallet operation", () => {
    const tx = (to: string, data: `0x${string}`) => ({ from: bundler, to, value: "0", data });
    expect(readWalletOperation(wallet, tx(usdc, transfer), [], true)).toMatchObject({ status: "unrecognized", reason: "not_entry_point" });
    expect(readWalletOperation(wallet, tx(ENTRY_POINT_V07, "0x1234"), [], true)).toMatchObject({ reason: "not_handle_ops" });
    expect(readWalletOperation(wallet, tx(ENTRY_POINT_V07, handleOpsV07([{ sender: other, callData: theirs }])), [], true))
      .toMatchObject({ reason: "operation_missing" });
    expect(readWalletOperation(wallet, tx(ENTRY_POINT_V07, handleOpsV07([{ sender: wallet, callData: mineCalls }, { sender: wallet, callData: mineCalls }])), [], true))
      .toMatchObject({ reason: "multiple_operations" });
    expect(readWalletOperation(wallet, tx(ENTRY_POINT_V07, handleOpsV07([{ sender: wallet, callData: "0xdeadbeef" }])), [], true))
      .toMatchObject({ reason: "account_encoding" });
    expect(readWalletOperation(wallet, tx(ENTRY_POINT_V07, handleOpsV07([{ sender: wallet, callData: mineCalls }])), [entryLog(ENTRY_POINT_V07, "before")], true))
      .toMatchObject({ reason: "operation_event_missing" });
  });
});
