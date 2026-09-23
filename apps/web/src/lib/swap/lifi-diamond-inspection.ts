import { decodeFunctionData, encodeFunctionData, getAddress, parseAbi } from "viem";

// Official GenericSwapFacetV3 / LibSwap ABI. This is inspection only: its
// nested SwapData.callTo/callData are arbitrary executable calls, not approved
// merely because the outer LI.FI selector decodes.
// https://github.com/lifinance/contracts/blob/main/src/Facets/GenericSwapFacetV3.sol
export const LIFI_ERC20_SWAP_ABI = parseAbi([
  "function swapTokensMultipleV3ERC20ToERC20(bytes32 _transactionId, string _integrator, string _referrer, address _receiver, uint256 _minAmountOut, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] _swapData) payable"
]);
export const LIFI_FEE_FORWARDER_ABI = parseAbi([
  "function forwardERC20Fees(address _token, (address recipient, uint256 amount)[] _distributions)"
]);
// https://github.com/lifinance/contracts/blob/main/src/Facets/AcrossFacetV4.sol
// Inspection only: the nested SwapData remains arbitrary executable code.
export const LIFI_ACROSS_V4_ABI = parseAbi([
  "function swapAndStartBridgeTokensViaAcrossV4((bytes32 transactionId, string bridge, string integrator, address referrer, address sendingAssetId, address receiver, uint256 minAmount, uint256 destinationChainId, bool hasSourceSwaps, bool hasDestinationCall) _bridgeData, (address callTo, address approveTo, address sendingAssetId, address receivingAssetId, uint256 fromAmount, bytes callData, bool requiresDeposit)[] _swapData, (bytes32 receiverAddress, bytes32 refundAddress, bytes32 sendingAssetId, bytes32 receivingAssetId, uint256 outputAmount, uint128 outputAmountMultiplier, bytes32 exclusiveRelayer, uint32 quoteTimestamp, uint32 fillDeadline, uint32 exclusivityParameter, bytes message) _acrossData) payable"
]);

const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

function evmAddressFromBytes32(value: `0x${string}`) {
  if (!/^0x0{24}[0-9a-fA-F]{40}$/.test(value)) throw new Error("LI.FI bridge address is not an EVM address.");
  return getAddress(`0x${value.slice(26)}`).toLowerCase();
}

export function inspectLifiAcrossV4Call(input: { data: string; recipient: string;
  sourceToken: string; destinationToken: string; destinationChainId: number; sourceAmountRaw: string }) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(input.data) || input.data.length > 131_074
    || !/^\d+$/.test(input.sourceAmountRaw) || BigInt(input.sourceAmountRaw) <= 0n)
    throw new Error("LI.FI Across call envelope is invalid.");
  const decoded = decodeFunctionData({ abi: LIFI_ACROSS_V4_ABI, data: input.data as `0x${string}` });
  if (decoded.functionName !== "swapAndStartBridgeTokensViaAcrossV4" || !decoded.args)
    throw new Error("LI.FI Across selector is not reviewed.");
  const canonical = encodeFunctionData({ abi: LIFI_ACROSS_V4_ABI,
    functionName: "swapAndStartBridgeTokensViaAcrossV4", args: decoded.args });
  if (canonical.toLowerCase() !== input.data.toLowerCase()) throw new Error("LI.FI Across encoding is not canonical.");
  const [bridge, rawSwaps, across] = decoded.args;
  const recipient = getAddress(input.recipient).toLowerCase();
  const sourceToken = getAddress(input.sourceToken).toLowerCase();
  const destinationToken = getAddress(input.destinationToken).toLowerCase();
  if (bridge.transactionId === `0x${"00".repeat(32)}` || bridge.bridge !== "across"
    || bridge.integrator !== "aurel" || bridge.destinationChainId !== BigInt(input.destinationChainId)
    || getAddress(bridge.receiver).toLowerCase() !== recipient
    || getAddress(bridge.sendingAssetId).toLowerCase() !== sourceToken
    || bridge.minAmount <= 0n || !bridge.hasSourceSwaps || bridge.hasDestinationCall
    || evmAddressFromBytes32(across.receiverAddress) !== recipient
    || evmAddressFromBytes32(across.refundAddress) !== recipient
    || evmAddressFromBytes32(across.sendingAssetId) !== sourceToken
    || evmAddressFromBytes32(across.receivingAssetId) !== destinationToken
    || across.outputAmount <= 0n || across.outputAmountMultiplier <= 0n
    || across.message !== "0x" || across.fillDeadline <= across.quoteTimestamp
    || rawSwaps.length < 1 || rawSwaps.length > 8)
    throw new Error("LI.FI Across call differs from the reviewed envelope.");
  const swaps = rawSwaps.map((swap) => {
    if (swap.fromAmount <= 0n || swap.callData.length < 10 || swap.callData.length > 8_194
      || [swap.callTo, swap.approveTo, swap.sendingAssetId, swap.receivingAssetId]
        .some((address) => getAddress(address) === ZERO_ADDRESS))
      throw new Error("LI.FI Across nested executable call is invalid.");
    return { callTo: swap.callTo.toLowerCase(), approveTo: swap.approveTo.toLowerCase(),
      sendingAssetId: swap.sendingAssetId.toLowerCase(), receivingAssetId: swap.receivingAssetId.toLowerCase(),
      fromAmountRaw: swap.fromAmount.toString(), callData: swap.callData.toLowerCase(),
      requiresDeposit: swap.requiresDeposit };
  });
  if (swaps[0].fromAmountRaw !== input.sourceAmountRaw)
    throw new Error("LI.FI Across source amount differs from request.");
  return { transactionId: bridge.transactionId.toLowerCase(), bridge: bridge.bridge,
    integrator: bridge.integrator, referrer: bridge.referrer.toLowerCase(), recipient,
    refundAddress: evmAddressFromBytes32(across.refundAddress), sourceToken, destinationToken,
    destinationChainId: Number(bridge.destinationChainId), minimumBridgeAmountRaw: bridge.minAmount.toString(),
    outputAmountRaw: across.outputAmount.toString(), outputAmountMultiplierRaw: across.outputAmountMultiplier.toString(),
    exclusiveRelayer: across.exclusiveRelayer.toLowerCase(), quoteTimestamp: across.quoteTimestamp,
    fillDeadline: across.fillDeadline, exclusivityParameter: across.exclusivityParameter, swaps };
}

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

// Inspection only. Matching a fee total does not make its recipients or the
// surrounding swap executable without independent policy and effect checks.
export function inspectLifiFeeForwarderCall(input: { data: string; token: string; expectedFeeRaw: string }) {
  if (!/^0x(?:[0-9a-fA-F]{2})+$/.test(input.data) || input.data.length > 16_386
    || !/^\d+$/.test(input.expectedFeeRaw) || BigInt(input.expectedFeeRaw) <= 0n)
    throw new Error("LI.FI fee call envelope is invalid.");
  const decoded = decodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, data: input.data as `0x${string}` });
  if (decoded.functionName !== "forwardERC20Fees" || !decoded.args)
    throw new Error("LI.FI fee selector is not reviewed.");
  const canonical = encodeFunctionData({ abi: LIFI_FEE_FORWARDER_ABI, functionName: "forwardERC20Fees", args: decoded.args });
  if (canonical.toLowerCase() !== input.data.toLowerCase()) throw new Error("LI.FI fee encoding is not canonical.");
  const [token, rawDistributions] = decoded.args;
  if (getAddress(token) !== getAddress(input.token) || rawDistributions.length < 1 || rawDistributions.length > 8)
    throw new Error("LI.FI fee token or distribution count differs from review.");
  const distributions = rawDistributions.map(({ recipient, amount }) => {
    if (getAddress(recipient) === ZERO_ADDRESS || amount <= 0n) throw new Error("LI.FI fee recipient or amount is invalid.");
    return { recipient: recipient.toLowerCase(), amountRaw: amount.toString() };
  });
  const total = rawDistributions.reduce((sum, distribution) => sum + distribution.amount, 0n);
  if (total !== BigInt(input.expectedFeeRaw)) throw new Error("LI.FI fee total differs from review.");
  return { token: token.toLowerCase(), totalFeeRaw: total.toString(), distributions };
}
