import { describe, expect, it } from "vitest";
import { encodeFunctionData } from "viem";
import { inspectLifiAcrossV4Call, inspectLifiDiamondSwap, inspectLifiFeeForwarderCall,
  LIFI_ACROSS_V4_ABI, LIFI_ERC20_SWAP_ABI, LIFI_FEE_FORWARDER_ABI } from "@/lib/swap/lifi-diamond-inspection";

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

describe("disconnected LI.FI Across V4 call inspection", () => {
  const arbiUsdc = "0xaf88d065e77c8cC2239327C5EDb3A432268e5831" as const;
  const asBytes32 = (address: Address) => `0x${"0".repeat(24)}${address.slice(2)}` as `0x${string}`;
  const bridgeData = { transactionId: txId, bridge: "across", integrator: "aurel",
    referrer: "0x0000000000000000000000000000000000000000" as Address, sendingAssetId: usdc as Address,
    receiver: wallet as Address, minAmount: 99_750_000n, destinationChainId: 42161n,
    hasSourceSwaps: true, hasDestinationCall: false };
  const feeSwap = { callTo: dex, approveTo: dex, sendingAssetId: usdc,
    receivingAssetId: usdc, fromAmount: 100_000_000n,
    callData: "0x332d746b" as const, requiresDeposit: true };
  const acrossData = { receiverAddress: asBytes32(wallet), refundAddress: asBytes32(wallet),
    sendingAssetId: asBytes32(usdc), receivingAssetId: asBytes32(arbiUsdc),
    outputAmount: 99_700_000n, outputAmountMultiplier: 1000000000000000000n,
    exclusiveRelayer: `0x${"00".repeat(32)}` as `0x${string}`,
    quoteTimestamp: 1_790_000_000, fillDeadline: 1_790_003_600,
    exclusivityParameter: 0, message: "0x" as const };
  const callAcross = (bridge = bridgeData, swaps = [feeSwap], across = acrossData) =>
    encodeFunctionData({ abi: LIFI_ACROSS_V4_ABI,
      functionName: "swapAndStartBridgeTokensViaAcrossV4", args: [bridge, swaps, across] });

  it("decodes the exact V4 selector, recipient, refund, token, amount and nested call", () => {
    const data = callAcross();
    expect(data.slice(0, 10)).toBe("0x1794958f");
    expect(inspectLifiAcrossV4Call({ data, recipient: wallet, sourceToken: usdc,
      destinationToken: arbiUsdc, destinationChainId: 42161, sourceAmountRaw: "100000000" }))
      .toMatchObject({ bridge: "across", integrator: "aurel", recipient: wallet.toLowerCase(),
        refundAddress: wallet.toLowerCase(), sourceToken: usdc.toLowerCase(),
        destinationToken: arbiUsdc.toLowerCase(), destinationChainId: 42161,
        swaps: [{ callTo: dex.toLowerCase(), fromAmountRaw: "100000000" }] });
  });

  it("rejects alternate recipient/refund, token, destination call and trailing data", () => {
    const expected = { recipient: wallet, sourceToken: usdc, destinationToken: arbiUsdc,
      destinationChainId: 42161, sourceAmountRaw: "100000000" };
    for (const data of [
      callAcross({ ...bridgeData, receiver: dex }),
      callAcross(bridgeData, [feeSwap], { ...acrossData, refundAddress: asBytes32(dex) }),
      callAcross(bridgeData, [feeSwap], { ...acrossData, receivingAssetId: asBytes32(weth) }),
      callAcross({ ...bridgeData, hasDestinationCall: true }),
      `${callAcross()}00`
    ]) expect(() => inspectLifiAcrossV4Call({ ...expected, data })).toThrow();
  });
});
