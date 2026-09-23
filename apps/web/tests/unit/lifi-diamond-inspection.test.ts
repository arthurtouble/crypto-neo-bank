import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { inspectLifiDiamondSwap, inspectLifiFeeForwarderCall, LIFI_ERC20_SWAP_ABI,
  LIFI_FEE_FORWARDER_ABI } from "@/lib/swap/lifi-diamond-inspection";

const wallet = "0x1111111111111111111111111111111111111111" as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913" as const;
const weth = "0x4200000000000000000000000000000000000006" as const;
const dex = "0x2222222222222222222222222222222222222222" as const;
const txId = `0x${"ab".repeat(32)}` as const;
type Address = `0x${string}`;

function call(overrides: { receiver?: Address; minimum?: bigint; swaps?: Array<{
  callTo: Address; approveTo: Address; sendingAssetId: Address; receivingAssetId: Address;
  fromAmount: bigint; callData: `0x${string}`; requiresDeposit: boolean;
}> } = {}) {
  return encodeFunctionData({ abi: LIFI_ERC20_SWAP_ABI, functionName: "swapTokensMultipleV3ERC20ToERC20",
    args: [txId, "aurel", "", overrides.receiver ?? wallet, overrides.minimum ?? 900_000n,
      overrides.swaps ?? [{ callTo: dex, approveTo: dex, sendingAssetId: usdc,
        receivingAssetId: weth, fromAmount: 1_000_000n, callData: "0x12345678", requiresDeposit: true }]] });
}

describe("disconnected LI.FI Diamond call inspection", () => {
  it("decodes the exact reviewed outer selector and nested executable fields", () => {
    const data = call();
    expect(data.slice(0, 10)).toBe("0x5fd9ae2e");
    expect(inspectLifiDiamondSwap({ data, receiver: wallet, minimumOutputRaw: "900000" }))
      .toMatchObject({ integrator: "aurel", receiver: wallet.toLowerCase(), minimumOutputRaw: "900000",
        swaps: [{ callTo: dex.toLowerCase(), approveTo: dex.toLowerCase(), sendingAssetId: usdc.toLowerCase(),
          receivingAssetId: weth.toLowerCase(), fromAmountRaw: "1000000", callData: "0x12345678", requiresDeposit: true }] });
  });

  it("rejects wrong receiver or minimum, unknown selector, and trailing bytes", () => {
    const data = call();
    expect(() => inspectLifiDiamondSwap({ data, receiver: dex, minimumOutputRaw: "900000" })).toThrow();
    expect(() => inspectLifiDiamondSwap({ data, receiver: wallet, minimumOutputRaw: "900001" })).toThrow();
    expect(() => inspectLifiDiamondSwap({ data: `0xdeadbeef${data.slice(10)}`, receiver: wallet, minimumOutputRaw: "900000" })).toThrow();
    expect(() => inspectLifiDiamondSwap({ data: `${data}00`, receiver: wallet, minimumOutputRaw: "900000" })).toThrow();
  });

  it("rejects empty, excessive, and non-executable nested swap arrays", () => {
    const swap = { callTo: dex, approveTo: dex, sendingAssetId: usdc, receivingAssetId: weth,
      fromAmount: 1_000_000n, callData: "0x12345678" as const, requiresDeposit: true };
    for (const swaps of [[], Array(9).fill(swap), [{ ...swap, callData: "0x" as const }],
      [{ ...swap, fromAmount: 0n }]]) {
      expect(() => inspectLifiDiamondSwap({ data: call({ swaps }), receiver: wallet,
        minimumOutputRaw: "900000" })).toThrow();
    }
  });
});

describe("disconnected LI.FI fee-forwarder inspection", () => {
  function feeCall(distributions: Array<{ recipient: Address; amount: bigint }> = [{ recipient: dex, amount: 2_500n }]) {
    return encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, functionName: "forwardERC20Fees",
      args: [usdc, distributions] });
  }

  it("requires the exact token and total fee while retaining recipients for review", () => {
    expect(feeCall().slice(0, 10)).toBe("0x332d746b");
    expect(inspectLifiFeeForwarderCall({ data: feeCall(), token: usdc, expectedFeeRaw: "2500" }))
      .toEqual({ token: usdc.toLowerCase(), totalFeeRaw: "2500",
        distributions: [{ recipient: dex.toLowerCase(), amountRaw: "2500" }] });
  });

  it("rejects wrong token, wrong total, zero recipient, empty or excessive distributions, and malformed calldata", () => {
    const base = { token: usdc, expectedFeeRaw: "2500" };
    expect(() => inspectLifiFeeForwarderCall({ ...base, token: weth, data: feeCall() })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, expectedFeeRaw: "2501", data: feeCall() })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, data: feeCall([{ recipient: "0x0000000000000000000000000000000000000000", amount: 2_500n }]) })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, data: feeCall([]) })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, data: feeCall(Array(9).fill({ recipient: dex, amount: 2_500n })) })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, data: `0xdeadbeef${feeCall().slice(10)}` })).toThrow();
    expect(() => inspectLifiFeeForwarderCall({ ...base, data: `${feeCall()}00` })).toThrow();
  });
});
