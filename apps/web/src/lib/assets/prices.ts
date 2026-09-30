import { formatUnits, parseAbi, type PublicClient } from "viem";
import { base } from "viem/chains";
import type { PriceSource } from "@/lib/assets/registry";
import { publicClient } from "@/lib/chain/rpc";

type ChainlinkSource = Extract<PriceSource, { kind: "chainlink" }>;
export type FeedPrice = { usd: string; observedAt: string };

const aggregatorAbi = parseAbi(["function latestRoundData() view returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound)"]);

export function baseClient(): PublicClient {
  return publicClient(base);
}

/**
 * A Chainlink feed's latest price in dollars, and when the feed last updated.
 * A non-positive answer, a timestamp in the future, or one older than the
 * source allows is unavailable (null), never the last value.
 */
export async function chainlinkUsd(source: ChainlinkSource, now: Date, client: PublicClient = baseClient()): Promise<FeedPrice | null> {
  try {
    const [, answer, , updatedAt] = await client.readContract({ address: source.feed, abi: aggregatorAbi, functionName: "latestRoundData" });
    const age = now.getTime() / 1000 - Number(updatedAt);
    if (answer <= 0n || age < -60 || age > source.maxAgeSeconds) return null;
    return { usd: formatUnits(answer, source.decimals), observedAt: new Date(Number(updatedAt) * 1000).toISOString() };
  } catch { return null; }
}
