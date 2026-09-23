import { decodeFunctionResult, encodeFunctionData, erc20Abi, getAddress, type PublicClient } from "viem";
import { parseAssetId } from "./assets";

type SourceBalanceRequest = {
  wallet: string;
  assetId: string;
  amountRaw: string;
  nowMs: number;
  maxAgeMs: number;
};

/** Independent source-chain balance evidence; never a signing authorization. */
export async function observeSwapSourceBalance(client: PublicClient, request: SourceBalanceRequest) {
  const asset = parseAssetId(request.assetId);
  if (!asset || !/^[1-9]\d*$/.test(request.amountRaw)
    || !Number.isSafeInteger(request.nowMs) || !Number.isSafeInteger(request.maxAgeMs) || request.maxAgeMs <= 0)
    throw new Error("Invalid Swap balance request.");
  const wallet = getAddress(request.wallet);
  if (await client.getChainId() !== asset.chainId) throw new Error("Source RPC chain mismatch.");
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null || !block.hash || !/^0x[0-9a-f]{64}$/i.test(block.hash))
    throw new Error("Source block unavailable.");
  const observedAtMs = Number(block.timestamp) * 1_000;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs > request.nowMs
    || request.nowMs - observedAtMs > request.maxAgeMs) throw new Error("Source balance block is stale.");
  const balance = asset.address === null
    ? await client.getBalance({ address: wallet, blockHash: block.hash, requireCanonical: true })
    : decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf",
      data: (await client.call({ to: getAddress(asset.address),
        data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
        blockHash: block.hash, requireCanonical: true })).data ?? "0x" });
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash?.toLowerCase() !== block.hash.toLowerCase() || canonical.timestamp !== block.timestamp)
    throw new Error("Canonical source block changed.");
  if (balance < BigInt(request.amountRaw)) throw new Error("Insufficient source asset balance.");
  return { chainId: asset.chainId, wallet, assetId: request.assetId, amountRaw: request.amountRaw,
    balanceRaw: balance.toString(), blockNumber: block.number, blockHash: block.hash, observedAtMs };
}
