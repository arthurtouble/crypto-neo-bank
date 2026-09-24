import { type PublicClient } from "viem";
import { validateAaveCall, type AaveCallAction } from "./aave-call-policy";

type ReviewedCall = {
  action: AaveCallAction;
  wallet: string;
  asset: string;
  amountRaw: bigint;
  call: unknown;
  blockNumber: bigint;
  blockHash: `0x${string}`;
  observedAtMs: number;
  now?: () => number;
};

/** Same-block revert check only; it does not authorize signing or establish finality. */
export async function simulateAaveBaseCall(client: Pick<PublicClient, "request" | "getBlock">, input: ReviewedCall) {
  const reviewed = validateAaveCall({ action: input.action, wallet: input.wallet, asset: input.asset,
    amountRaw: input.amountRaw, transaction: input.call });
  const now = input.now ?? Date.now;
  const fresh = () => Number.isFinite(input.observedAtMs) && Number.isFinite(now())
    && input.observedAtMs <= now() && now() - input.observedAtMs <= 30_000;
  if (!fresh()) throw new Error("Aave risk evidence is stale.");
  if (input.blockNumber <= 0n || !/^0x[a-fA-F0-9]{64}$/.test(input.blockHash)
    || input.blockHash === `0x${"0".repeat(64)}`) throw new Error("Aave canonical block is invalid.");
  const tx = reviewed.call;
  try {
    const result = await client.request({ method: "eth_call", params: [
      { from: tx.from, to: tx.to, data: tx.data, value: "0x0" },
      { blockHash: input.blockHash, requireCanonical: true }
    ] } as never);
    if (typeof result !== "string" || !/^0x(?:[a-fA-F0-9]{2})*$/.test(result))
      throw new Error("Invalid Aave simulation response.");
  } catch {
    throw new Error("Aave call simulation failed.");
  }
  const canonical = await client.getBlock({ blockNumber: input.blockNumber });
  if (canonical.hash?.toLowerCase() !== input.blockHash.toLowerCase())
    throw new Error("Aave canonical block changed during simulation.");
  if (!fresh()) throw new Error("Aave risk evidence is stale.");
  return { blockNumber: input.blockNumber.toString(), blockHash: input.blockHash, observedAtMs: input.observedAtMs };
}
