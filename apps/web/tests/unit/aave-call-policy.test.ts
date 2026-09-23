import { describe, expect, it } from "vitest";
import { encodeFunctionData, maxUint256 } from "viem";
import { validateAaveCall } from "@/lib/defi/aave-call-policy";

const wallet = "0x2222222222222222222222222222222222222222";
const other = "0x3333333333333333333333333333333333333333";
const pool = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
const usdc = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const weth = "0x4200000000000000000000000000000000000006";
const amount = 1_000_000n;
const abi = [
  { type: "function", name: "supply", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }, { type: "uint16" }] },
  { type: "function", name: "withdraw", inputs: [{ type: "address" }, { type: "uint256" }, { type: "address" }] },
  { type: "function", name: "borrow", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "uint16" }, { type: "address" }] },
  { type: "function", name: "repay", inputs: [{ type: "address" }, { type: "uint256" }, { type: "uint256" }, { type: "address" }] },
  { type: "function", name: "approve", inputs: [{ type: "address" }, { type: "uint256" }] }
] as const;

function tx(to: string, data: `0x${string}`, overrides: Record<string, unknown> = {}) {
  return { chainId: 8453, from: wallet, to, data, value: "0", ...overrides };
}

function call(action: "supply" | "withdraw" | "borrow" | "repay", args: readonly unknown[], overrides: Record<string, unknown> = {}) {
  const data = encodeFunctionData({ abi, functionName: action, args: args as never });
  return validateAaveCall({ action, wallet, asset: usdc, amountRaw: amount, transaction: tx(pool, data), ...overrides });
}

describe("Aave Base exact-call policy", () => {
  it.each([
    ["supply", [usdc, amount, wallet, 0]],
    ["withdraw", [usdc, amount, wallet]],
    ["borrow", [usdc, amount, 2n, 0, wallet]],
    ["repay", [usdc, amount, 2n, wallet]]
  ] as const)("accepts exact %s", (action, args) => {
    expect(call(action, args)).toMatchObject({ action, asset: usdc.toLowerCase(), amountRaw: amount.toString() });
  });

  it.each([
    ["other chain", { chainId: 1 }],
    ["other signer", { from: other }],
    ["other pool", { to: other }],
    ["nonzero value", { value: "1" }],
    ["extra transaction field", { calls: [{ to: other }] }]
  ])("rejects %s", (_name, override) => {
    const data = encodeFunctionData({ abi, functionName: "supply", args: [usdc, amount, wallet, 0] });
    expect(() => validateAaveCall({ action: "supply", wallet, asset: usdc, amountRaw: amount, transaction: tx(pool, data, override) })).toThrow();
  });

  it.each([
    ["wrong reserve", "supply", [weth, amount, wallet, 0]],
    ["wrong amount", "supply", [usdc, amount + 1n, wallet, 0]],
    ["third-party supply", "supply", [usdc, amount, other, 0]],
    ["nonzero referral", "supply", [usdc, amount, wallet, 1]],
    ["third-party withdrawal", "withdraw", [usdc, amount, other]],
    ["stable borrow", "borrow", [usdc, amount, 1n, 0, wallet]],
    ["delegated borrow", "borrow", [usdc, amount, 2n, 0, other]],
    ["wrong repay mode", "repay", [usdc, amount, 1n, wallet]]
  ] as const)("rejects %s", (_name, action, args) => {
    expect(() => call(action, args)).toThrow();
  });

  it("rejects a different selector even with plausible arguments", () => {
    const data = encodeFunctionData({ abi, functionName: "withdraw", args: [usdc, amount, wallet] });
    expect(() => validateAaveCall({ action: "supply", wallet, asset: usdc, amountRaw: amount, transaction: tx(pool, data) })).toThrow();
  });

  it("rejects trailing calldata and an ungoverned asset", () => {
    const data = encodeFunctionData({ abi, functionName: "supply", args: [usdc, amount, wallet, 0] });
    expect(() => validateAaveCall({ action: "supply", wallet, asset: usdc, amountRaw: amount, transaction: tx(pool, `${data}00`) })).toThrow();
    expect(() => validateAaveCall({ action: "supply", wallet, asset: other, amountRaw: amount, transaction: tx(pool, data) })).toThrow();
  });

  it("permits max only for explicitly reviewed withdraw and repay", () => {
    expect(call("withdraw", [usdc, maxUint256, wallet], { max: true, amountRaw: 1n })).toMatchObject({ amountMode: "max", amountRaw: null });
    expect(call("repay", [usdc, maxUint256, 2n, wallet], { max: true, amountRaw: 1n })).toMatchObject({ amountMode: "max", amountRaw: null });
    expect(() => call("withdraw", [usdc, maxUint256, wallet])).toThrow();
    expect(() => call("supply", [usdc, maxUint256, wallet, 0], { max: true })).toThrow();
  });

  it("allows only a bounded exact approval for the governed pool and token", () => {
    const data = encodeFunctionData({ abi, functionName: "approve", args: [pool, amount] });
    expect(validateAaveCall({ action: "approve", wallet, asset: usdc, amountRaw: amount, transaction: tx(usdc, data) }).action).toBe("approve");
    for (const [target, spender, approved] of [[other, pool, amount], [usdc, other, amount], [usdc, pool, maxUint256]] as const) {
      const bad = encodeFunctionData({ abi, functionName: "approve", args: [spender, approved] });
      expect(() => validateAaveCall({ action: "approve", wallet, asset: usdc, amountRaw: amount, transaction: tx(target, bad) })).toThrow();
    }
  });
});
