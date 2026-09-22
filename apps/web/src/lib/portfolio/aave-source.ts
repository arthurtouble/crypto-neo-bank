import { AAVE_BASE_V3_MARKET, callAaveTool } from "@/lib/defi/aave";
import type { AccountId, Completeness, HistoricalEvent, HistoricalEventSource, HistoryPage } from "@/lib/portfolio/types";
import { createPublicClient, http } from "viem";
import { base } from "viem/chains";

const SOURCE_ID = "aave:v3:8453";
type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type Verify = (hash: `0x${string}`, blockNumber: bigint) => Promise<{ blockHash: string | null; finalized: boolean; receiptSuccess: boolean }>;
type Options = { call?: ToolCall; now?: Date; verify?: Verify; confirmationDepth?: bigint };
type Row = Record<string, unknown>;
function record(value: unknown): Row | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Row : null; }
function v3(value: unknown): Row | null { return record(record(record(value)?.data)?.v3); }
function address(value: unknown): string | null { return typeof value === "string" && /^0x[a-f0-9]{40}$/i.test(value) ? value.toLowerCase() : null; }
function iso(value: unknown): string | null { return typeof value === "string" && Number.isFinite(Date.parse(value)) ? new Date(value).toISOString() : null; }
function rawAmount(value: unknown, decimals: number): string | null {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)(?:\.\d+)?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > decimals) return null;
  return (BigInt(whole) * 10n ** BigInt(decimals) + BigInt((fraction + "0".repeat(decimals)).slice(0, decimals) || "0")).toString();
}
function reserveOf(value: unknown): { assetId: string; decimals: number } | null {
  const reserve = record(value);
  const contract = address(reserve?.underlyingToken);
  const decimals = Number(reserve?.decimals);
  return contract && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? { assetId: `8453:${contract}`, decimals } : null;
}
function governed(value: unknown): boolean { return address(value) === AAVE_BASE_V3_MARKET.toLowerCase(); }

export async function readCurrentAaveLegs(accountId: AccountId, options: Options = {}): Promise<{ legs: Array<{ assetId: string; side: "supply" | "debt"; rawUnits: string; decimals: number; market: string; observedAt: string; sourceId: string }>; status: Completeness; reason: string | null }> {
  const unavailable = (reason: string, status: Completeness = "partial") => ({ legs: [], status, reason });
  if (!/^8453:0x[a-f0-9]{40}$/.test(accountId)) return unavailable("unsupported_account", "unavailable");
  const call = options.call ?? callAaveTool;
  let positions: Row | null; let summary: Row | null;
  try {
    [positions, summary] = await Promise.all([
      call("get_user_positions", { user: accountId.slice(5), version: "v3", chainId: 8453 }).then(v3),
      call("get_user_summary", { user: accountId.slice(5), version: "v3", chainId: 8453 }).then(v3)
    ]);
  } catch { return unavailable("aave_unavailable", "unavailable"); }
  if (!positions || !summary || !Array.isArray(positions.supplies) || !Array.isArray(positions.borrows) || !Array.isArray(summary.markets) || !summary.markets.some((item) => governed(record(item)?.market))) return unavailable("aave_position_incomplete");
  const legs: Array<{ assetId: string; side: "supply" | "debt"; rawUnits: string; decimals: number; market: string; observedAt: string; sourceId: string }> = [];
  const observedAt = (options.now ?? new Date()).toISOString();
  for (const [key, side] of [["supplies", "supply"], ["borrows", "debt"]] as const) {
    for (const item of positions[key] as unknown[]) {
      const row = record(item);
      const reserve = reserveOf(row?.reserve);
      const amount = reserve ? rawAmount(row?.balance, reserve.decimals) : null;
      if (!row || !governed(row.market) || !reserve || amount === null) return unavailable("aave_position_incomplete");
      legs.push({ assetId: reserve.assetId, side, rawUnits: side === "debt" && amount !== "0" ? `-${amount}` : amount, decimals: reserve.decimals, market: AAVE_BASE_V3_MARKET.toLowerCase(), observedAt, sourceId: SOURCE_ID });
    }
  }
  return { legs, status: "complete", reason: null };
}

export class BaseAaveSource implements HistoricalEventSource {
  readonly sourceId = SOURCE_ID;
  private readonly call: ToolCall;
  private readonly options: Options;
  constructor(options: Options = {}) { this.options = options; this.call = options.call ?? callAaveTool; }

  async page(input: { accountId: AccountId; cursor: string | null; from: string; through: string; limit: number }): Promise<HistoryPage> {
    const partial = (events: HistoricalEvent[] = []): HistoryPage => ({ events, nextCursor: null, coveredThrough: input.from, complete: false, sourceId: SOURCE_ID });
    if (!/^8453:0x[a-f0-9]{40}$/.test(input.accountId) || !Number.isInteger(input.limit) || input.limit < 1 || input.limit > 100 || !iso(input.from) || !iso(input.through)) return partial();
    let root: Row | null;
    try { root = v3(await this.call("get_user_activity", { user: input.accountId.slice(5), version: "v3", chainId: 8453, limit: input.limit, ...(input.cursor ? { cursor: input.cursor } : {}) })); }
    catch { return partial(); }
    const info = record(root?.pageInfo);
    if (!root || !Array.isArray(root.items) || !info || typeof info.hasNextPage !== "boolean" || (info.hasNextPage && (typeof info.next !== "string" || !info.next || info.next === input.cursor)) || root.partial === true) return partial();
    const events: HistoricalEvent[] = [];
    const seen = new Set<string>();
    for (const item of root.items) {
      const row = record(item);
      const txHash = typeof row?.txHash === "string" && /^0x[a-f0-9]{64}$/i.test(row.txHash) ? row.txHash.toLowerCase() : null;
      const occurredAt = iso(row?.timestamp);
      if (!occurredAt) return partial(events);
      if (occurredAt < input.from || occurredAt >= input.through) continue;
      const reserve = reserveOf(row?.reserve);
      const amount = reserve ? rawAmount(row?.amount, reserve.decimals) : null;
      const type = typeof row?.__typename === "string" ? row.__typename.toLowerCase() : "";
      const kind = type.includes("borrow") ? "borrow" : type.includes("repay") ? "repay" : type.includes("supply") || type.includes("deposit") ? "supply" : type.includes("withdraw") || type.includes("redeem") ? "redeem" : "unknown";
      const logIndex = row?.logIndex;
      const blockHash = typeof row?.blockHash === "string" && /^0x[a-f0-9]{64}$/i.test(row.blockHash) ? row.blockHash.toLowerCase() : null;
      const blockNumber = typeof row?.blockNumber === "number" && Number.isSafeInteger(row.blockNumber) ? String(row.blockNumber) : null;
      const id = `${input.accountId}:${txHash}:${logIndex}`;
      if (!row || !txHash || !occurredAt || !reserve || amount === null || !governed(row.market) || !Number.isInteger(logIndex) || !blockHash || !blockNumber || seen.has(id) || kind === "unknown") return partial(events);
      seen.add(id);
      let proof: Awaited<ReturnType<Verify>>;
      try { proof = await (this.options.verify ?? ((h, n) => this.verifyRpc(h, n)))(txHash as `0x${string}`, BigInt(blockNumber)); }
      catch { return partial(events); }
      const finalized = proof.blockHash?.toLowerCase() === blockHash && proof.finalized && proof.receiptSuccess;
      if (!finalized) return partial(events);
      events.push({ sourceId: SOURCE_ID, sourceName: "Aave V3 Base", sourceEventId: id, ingestionVersion: 1, accountId: input.accountId, assetId: reserve.assetId, rawDelta: kind === "redeem" || kind === "borrow" ? `-${amount}` : amount, decimals: reserve.decimals, kind, occurredAt, chainId: 8453, blockNumber, blockHash, txHash, logIndex: logIndex as number, finality: "finalized", completeness: "complete", groupId: txHash, counterpartyAccountId: null, evidenceJson: JSON.stringify({ market: AAVE_BASE_V3_MARKET, type: row.__typename }) });
    }
    const complete = !info.hasNextPage;
    return { events, nextCursor: complete ? null : info.next as string, coveredThrough: complete ? input.through : input.from, complete, sourceId: SOURCE_ID };
  }

  private async verifyRpc(txHash: `0x${string}`, blockNumber: bigint): ReturnType<Verify> {
    const client = createPublicClient({ chain: base, transport: http() });
    const [receipt, block, tip] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getBlock({ blockNumber }), client.getBlockNumber()]);
    return { blockHash: block.hash, receiptSuccess: receipt.status === "success" && receipt.blockHash === block.hash, finalized: tip >= blockNumber + (this.options.confirmationDepth ?? 20n) };
  }
}
