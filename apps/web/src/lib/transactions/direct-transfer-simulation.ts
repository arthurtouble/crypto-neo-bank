import { decodeFunctionResult, encodeFunctionData, erc20Abi, type PublicClient } from "viem";
import { BASE_ASSETS } from "@/config/chains";
import { normalizePreparedCall, type NormalizedPreparedCall } from "./evidence";

type DirectTransferEffect =
  | { type: "native_transfer"; recipient: string; amountRaw: string }
  | { type: "erc20_transfer"; token: string; recipient: string; amountRaw: string };

type Request = {
  call: NormalizedPreparedCall;
  effect: DirectTransferEffect;
  nowMs: number;
  maxAgeMs: number;
};

/** Simulation evidence only. It neither proves spendable balance/gas nor authorizes signing. */
export async function simulateBaseDirectTransfer(client: PublicClient, request: Request) {
  const { call, effect } = request;
  const normalized = await normalizePreparedCall(call);
  if (call.chainId !== 8453 || normalized.fingerprint !== call.fingerprint || normalized.dataHash !== call.dataHash
    || normalized.data !== call.data || normalized.value !== call.value)
    throw new Error("Prepared transfer identity changed or chain is unsupported.");
  if (!/^[1-9]\d*$/.test(effect.amountRaw)) throw new Error("Invalid transfer amount.");
  const amount = BigInt(effect.amountRaw);
  if (effect.type === "native_transfer") {
    if (call.to.toLowerCase() !== effect.recipient.toLowerCase() || call.value !== effect.amountRaw || call.data !== "0x")
      throw new Error("Native transfer does not match its expected effect.");
  } else {
    const supportedTokens = Object.values(BASE_ASSETS).map((asset) => asset.address).filter((address) => address !== null);
    if (!supportedTokens.some((address) => address.toLowerCase() === effect.token.toLowerCase())
      || call.to.toLowerCase() !== effect.token.toLowerCase() || call.value !== "0")
      throw new Error("Unsupported or mismatched token transfer.");
    const expectedData = encodeFunctionData({ abi: erc20Abi, functionName: "transfer",
      args: [effect.recipient as `0x${string}`, amount] });
    if (call.data.toLowerCase() !== expectedData.toLowerCase())
      throw new Error("Token transfer calldata does not match its expected effect.");
  }
  if (!Number.isSafeInteger(request.nowMs) || !Number.isSafeInteger(request.maxAgeMs) || request.maxAgeMs <= 0)
    throw new Error("Invalid simulation clock or freshness window.");
  if (await client.getChainId() !== 8453) throw new Error("Base RPC chain mismatch.");
  const block = await client.getBlock({ blockTag: "latest" });
  if (block.number === null || !block.hash || !/^0x[\da-f]{64}$/i.test(block.hash)
    || block.hash === `0x${"0".repeat(64)}`)
    throw new Error("Canonical simulation block unavailable.");
  const observedAtMs = Number(block.timestamp) * 1_000;
  if (!Number.isSafeInteger(observedAtMs) || observedAtMs > request.nowMs
    || request.nowMs - observedAtMs > request.maxAgeMs)
    throw new Error("Simulation block is stale or invalid.");
  const result = await client.call({ account: normalized.from, to: normalized.to,
    value: BigInt(normalized.value), data: normalized.data,
    blockHash: block.hash, requireCanonical: true });
  if (effect.type === "erc20_transfer" && result.data !== `0x${"0".repeat(63)}1`)
    throw new Error("Token transfer simulation did not return true.");
  const assetBalance = effect.type === "native_transfer"
    ? await client.getBalance({ address: normalized.from, blockHash: block.hash, requireCanonical: true })
    : decodeFunctionResult({ abi: erc20Abi, functionName: "balanceOf", data: (await client.call({
      to: normalized.to,
      data: encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [normalized.from] }),
      blockHash: block.hash, requireCanonical: true
    })).data ?? "0x" });
  if (assetBalance < amount) throw new Error("Insufficient asset balance at the simulation block.");
  const canonical = await client.getBlock({ blockNumber: block.number });
  if (canonical.hash?.toLowerCase() !== block.hash.toLowerCase() || canonical.timestamp !== block.timestamp)
    throw new Error("Canonical simulation block changed.");
  return {
    chainId: 8453 as const,
    blockNumber: block.number,
    blockHash: block.hash,
    observedAtMs,
    fingerprint: normalized.fingerprint,
    simulationSucceeded: true as const,
    assetBalanceRaw: assetBalance.toString(),
    assetBalanceObserved: true as const,
    balanceAndGasProven: false as const,
    signingReady: false as const
  };
}
