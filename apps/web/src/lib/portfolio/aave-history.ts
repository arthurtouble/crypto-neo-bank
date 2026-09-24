import type { PublicClient } from "viem";

export type HistoricalBlock = { number: bigint; hash: `0x${string}`; timestamp: bigint };
export type HistoricalBlockResult =
  | { status: "complete"; day: string; block: HistoricalBlock; successor: HistoricalBlock }
  | { status: "unavailable"; day: string; reason: string };

type Options = { client: PublicClient; now?: Date; confirmationDepth?: bigint };
const HASH = /^0x[0-9a-f]{64}$/i;

function validBlock(value: unknown, expectedNumber: bigint): HistoricalBlock | null {
  if (!value || typeof value !== "object") return null;
  const block = value as Record<string, unknown>;
  if (block.number !== expectedNumber || typeof block.hash !== "string" || !HASH.test(block.hash)
    || /^0x0{64}$/i.test(block.hash) || typeof block.timestamp !== "bigint" || block.timestamp < 0n) return null;
  return { number: expectedNumber, hash: block.hash as `0x${string}`, timestamp: block.timestamp };
}

function sameBlock(a: HistoricalBlock, b: HistoricalBlock | null): boolean {
  return !!b && a.number === b.number && a.hash.toLowerCase() === b.hash.toLowerCase() && a.timestamp === b.timestamp;
}

export async function resolveHistoricalAaveBlock(day: string, options: Options): Promise<HistoricalBlockResult> {
  const unavailable = (reason: string): HistoricalBlockResult => ({ status: "unavailable", day, reason });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return unavailable("invalid_day");
  const start = Date.parse(`${day}T00:00:00.000Z`);
  const now = (options.now ?? new Date()).getTime();
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 10) !== day
    || !Number.isFinite(now) || start + 86_400_000 > now) return unavailable("incomplete_day");
  const midnight = BigInt((start + 86_400_000) / 1000);
  const client = options.client;
  try {
    if (await client.getChainId() !== 8453) return unavailable("unsupported_chain");
    const tip = await client.getBlockNumber();
    const depth = options.confirmationDepth ?? 20n;
    if (depth < 1n || tip <= depth) return unavailable("finality_unavailable");
    const confirmedTip = tip - depth;
    const observed = new Map<bigint, HistoricalBlock>();
    const read = async (number: bigint) => {
      const block = validBlock(await client.getBlock({ blockNumber: number }), number);
      if (!block) return null;
      for (const previous of observed.values()) {
        if ((previous.number === number && !sameBlock(previous, block))
          || (previous.number < number && previous.timestamp > block.timestamp)
          || (previous.number > number && previous.timestamp < block.timestamp)) throw new Error("Inconsistent archive blocks");
      }
      observed.set(number, block);
      return block;
    };
    const last = await read(confirmedTip);
    if (!last || last.timestamp < midnight) return unavailable("finality_unavailable");
    let low = 0n;
    let high = confirmedTip;
    let calls = 0;
    while (low < high) {
      if (++calls > 64) return unavailable("search_bound_exceeded");
      const middle = (low + high) / 2n;
      const candidate = await read(middle);
      if (!candidate) return unavailable("block_unavailable");
      if (candidate.timestamp < midnight) low = middle + 1n;
      else high = middle;
    }
    if (low === 0n) return unavailable("day_before_chain");
    const [block, successor] = await Promise.all([read(low - 1n), read(low)]);
    if (!block || !successor || block.timestamp >= midnight || successor.timestamp < midnight || block.timestamp > successor.timestamp)
      return unavailable("midnight_boundary_unavailable");
    return { status: "complete", day, block, successor };
  } catch {
    return unavailable("archive_unavailable");
  }
}

export async function verifyHistoricalAaveBlock(result: HistoricalBlockResult, client: PublicClient): Promise<boolean> {
  if (result.status !== "complete") return false;
  try {
    const [block, successor] = await Promise.all([
      client.getBlock({ blockNumber: result.block.number }),
      client.getBlock({ blockNumber: result.successor.number })
    ]);
    return sameBlock(result.block, validBlock(block, result.block.number))
      && sameBlock(result.successor, validBlock(successor, result.successor.number));
  } catch { return false; }
}
