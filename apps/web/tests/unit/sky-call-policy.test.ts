import { describe, expect, it } from "vitest";
import { decodeFunctionData, parseUnits } from "viem";
import { buildSkyCall, skyActionsAbi, skyConversionLimit, validateSkyCall,
  SKY_SUSDS, SKY_USDC, SKY_USDC_ACTIONS } from "@/lib/defi/sky-call-policy";

const wallet = "0x1111111111111111111111111111111111111111";
const amountRaw = parseUnits("12.5", 6);

describe("Sky USDC wallet calls", () => {
  it("deposits Ethereum USDC into the owner's sUSDS through Spark's wrapper", () => {
    const call = buildSkyCall({ action: "deposit", wallet, amountRaw });
    expect(call).toMatchObject({ chainId: 1, from: wallet, to: SKY_USDC_ACTIONS, value: "0" });
    expect(decodeFunctionData({ abi: skyActionsAbi, data: call.data })).toMatchObject({
      functionName: "swapAndDeposit", args: [wallet, amountRaw, parseUnits("12.375", 18)]
    });
    expect(skyConversionLimit("deposit", amountRaw)).toBe(parseUnits("12.375", 18));
    expect(() => validateSkyCall({ action: "deposit", wallet, amountRaw, transaction: call })).not.toThrow();
  });

  it("withdraws bounded USDC to the owner and approves only needed sUSDS shares", () => {
    const call = buildSkyCall({ action: "withdraw", wallet, amountRaw });
    expect(decodeFunctionData({ abi: skyActionsAbi, data: call.data })).toMatchObject({
      functionName: "withdrawAndSwap", args: [wallet, amountRaw, parseUnits("12.625", 18)]
    });
    const approvalShares = 13n * 10n ** 18n;
    const approval = buildSkyCall({ action: "withdraw", wallet, amountRaw, approvalShares });
    expect(approval.to).toBe(SKY_SUSDS);
    expect(() => validateSkyCall({ action: "withdraw", wallet, amountRaw, approvalShares, transaction: approval })).not.toThrow();
    expect(buildSkyCall({ action: "deposit", wallet, amountRaw, approvalShares: amountRaw }).to).toBe(SKY_USDC);
  });

  it("rejects a changed recipient, target, chain, value, conversion limit or approval amount", () => {
    const call = buildSkyCall({ action: "withdraw", wallet, amountRaw });
    const malicious = { ...call, data: call.data.replace(wallet.slice(2).toLowerCase(), "2".repeat(40)) };
    for (const transaction of [malicious, { ...call, to: SKY_USDC }, { ...call, chainId: 8453 },
      { ...call, value: "1" }, { ...call, data: call.data.slice(0, -1) + (call.data.endsWith("0") ? "1" : "0") }]) {
      expect(() => validateSkyCall({ action: "withdraw", wallet, amountRaw, transaction })).toThrow();
    }
    const approval = buildSkyCall({ action: "deposit", wallet, amountRaw, approvalShares: amountRaw });
    expect(() => validateSkyCall({ action: "deposit", wallet, amountRaw: amountRaw + 1n,
      approvalShares: amountRaw + 1n, transaction: approval })).toThrow();
  });
});
