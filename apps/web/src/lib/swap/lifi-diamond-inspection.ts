import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";

// Official GenericSwapFacetV3 / LibSwap ABI. This is inspection only: its
// nested SwapData.callTo/callData are arbitrary executable calls, not approved
// merely because the outer LI.FI selector decodes.
// https://github.com/lifinance/contracts/blob/main/src/Facets/GenericSwapFacetV3.sol
export const LIFI_ERC20_SWAP_ABI = parseAbi([
  "function swapTokensMultipleV3ERC20ToERC20(bytes32 _transactionId, string _integrator, string _referrer, address _receiver, uint256 _minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] _swapData) payable"
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

export function inspectLifiDiamondSwap(input: { data: string; receiver: string; minimumOutputRaw: string }) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(input.data) || input.data.length > 131_074
    || !/^\d+$/.test(input.minimumOutputRaw) || BigInt(input.minimumOutputRaw) <= 0n)
    throw new Error("LI.FI call envelope is invalid.");
  const decoded = decodeFunctionData({ abi: LIFI_ERC20_SWAP_ABI, data: input.data as `0x${string}` });
  if (decoded.functionName !== "swapTokensMultipleV3ERC20ToERC20" || !decoded.args)
    throw new Error("LI.FI call selector is not reviewed.");
  const [transactionId, integrator, referrer, receiver, minimumOutput, swapData] = decoded.args;
  const canonical = encodeFunctionData({ abi: LIFI_ERC20_SWAP_ABI,
    functionName: "swapTokensMultipleV3ERC20ToERC20", args: decoded.args });
  if (canonical.toLowerCase() !== input.data.toLowerCase()) throw new Error("LI.FI call encoding is not canonical.");
  if (transactionId === `0x${"00".repeat(32)}` || integrator.length > 80 || referrer.length > 80
    || getAddress(receiver) !== getAddress(input.receiver) || minimumOutput !== BigInt(input.minimumOutputRaw)
    || swapData.length < 1 || swapData.length > 8) throw new Error("LI.FI call differs from the reviewed envelope.");
  const swaps = swapData.map((swap) => {
    if (swap.fromAmount <= 0n || swap.callData.length < 10 || swap.callData.length > 8_194
      || [swap.callTo, swap.approveTo, swap.sendingAssetId, swap.receivingAssetId]
        .some((address) => getAddress(address) === ZERO_ADDRESS))
      throw new Error("LI.FI nested executable call is invalid.");
    return { callTo: swap.callTo.toLowerCase(), approveTo: swap.approveTo.toLowerCase(),
      sendingAssetId: swap.sendingAssetId.toLowerCase(), receivingAssetId: swap.receivingAssetId.toLowerCase(),
      fromAmountRaw: swap.fromAmount.toString(), callData: swap.callData.toLowerCase(),
      requiresDeposit: swap.requiresDeposit };
  });
  return { transactionId: transactionId.toLowerCase(), integrator, referrer,
    receiver: receiver.toLowerCase(), minimumOutputRaw: minimumOutput.toString(), swaps };
}
