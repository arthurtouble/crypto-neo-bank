import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { inspectLifiDiamondSwap, LIFI_ERC20_SWAP_ABI } from "@/lib/swap/lifi-diamond-inspection";

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
