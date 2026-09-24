import { AAVE_BASE_PROTOCOL, AAVE_BASE_V3_MARKET, callAaveTool } from "@/lib/defi/aave";
import type { AccountId, Completeness, HistoricalEvent, HistoricalEventSource, HistoryPage } from "@/lib/portfolio/types";
import { createPublicClient, decodeEventLog, decodeFunctionResult, encodeFunctionData, http, parseAbi, parseAbiItem, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";

const SOURCE_ID = "aave:v3:8453";
const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
type ToolCall = (name: string, args: Record<string, unknown>) => Promise<unknown>;
type PoolLog = { address: string; logIndex: number | null; topics: readonly unknown[]; data: `0x${string}` };
type Verify = (hash: `0x${string}`, blockNumber: bigint) => Promise<{ blockHash: string | null; blockTimestamp?: bigint; finalized: boolean; receiptSuccess: boolean; logs?: PoolLog[] }>;
type Options = { call?: ToolCall; client?: PublicClient; now?: Date; verify?: Verify; confirmationDepth?: bigint };
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
  if (typeof reserve?.decimals !== "number" && (typeof reserve?.decimals !== "string" || !/^(0|[1-9]\d*)$/.test(reserve.decimals))) return null;
  const decimals = Number(reserve?.decimals);
  return contract && Number.isInteger(decimals) && decimals >= 0 && decimals <= 36 ? { assetId: `8453:${contract}`, decimals } : null;
}
function governed(value: unknown): boolean { return address(value) === AAVE_BASE_V3_MARKET.toLowerCase(); }
const POOL_EVENTS = {
  supply: parseAbiItem("event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)"),
  redeem: parseAbiItem("event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)"),
  borrow: parseAbiItem("event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)"),
  repay: parseAbiItem("event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)")
} as const;
function matchesPoolEvent(log: PoolLog, kind: keyof typeof POOL_EVENTS, asset: string, wallet: string, amount: string, logIndex: number): boolean {
  if (!governed(log.address) || log.logIndex !== logIndex) return false;
  if (!log.topics.length || !log.topics.every((topic) => typeof topic === "string" && /^0x[0-9a-f]*$/i.test(topic))) return false;
  try {
    const decoded = decodeEventLog({ abi: [POOL_EVENTS[kind]], data: log.data, topics: log.topics as [`0x${string}`, ...`0x${string}`[]], strict: true });
    const args = decoded.args as Record<string, unknown>;
    const owner = kind === "supply" || kind === "borrow" ? args.onBehalfOf : args.user;
    return address(args.reserve) === asset && address(owner) === wallet && args.amount === BigInt(amount);
  } catch { return false; }
}

export async function readCurrentAaveLegs(accountId: AccountId, options: Options = {}): Promise<{ legs: Array<{ assetId: string; side: "supply" | "debt"; rawUnits: string; decimals: number; market: string; observedAt: string; sourceId: string }>; status: Completeness; reason: string | null }> {
  const unavailable = (reason: string, status: Completeness = "unavailable") => ({ legs: [], status, reason });
  if (!/^8453:0x[a-f0-9]{40}$/.test(accountId)) return unavailable("unsupported_account");
  const client = options.client ?? createPublicClient({ chain: base, transport: http("https://base-rpc.publicnode.com", { retryCount: 0, timeout: 12_000 }) });
  const legs: Array<{ assetId: string; side: "supply" | "debt"; rawUnits: string; decimals: number; market: string; observedAt: string; sourceId: string }> = [];
  const abi = parseAbi([
    "function getPool() view returns (address)",
    "function getPoolDataProvider() view returns (address)",
    "function getReservesList() view returns (address[])",
    "function getUserReserveData(address asset,address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
    "function getReserveConfigurationData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
    "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"
  ]);
  let stage = "chain";
  try {
    if (await client.getChainId() !== 8453) return unavailable("aave_chain_mismatch");
    const tip = await client.getBlockNumber();
    const depth = options.confirmationDepth ?? 20n;
    if (depth < 1n || tip < depth) return unavailable("aave_finality_unavailable");
    const block = await client.getBlock({ blockNumber: tip - depth });
    if (block.number !== tip - depth || !block.hash || !/^0x[\da-f]{64}$/i.test(block.hash)
      || /^0x0{64}$/i.test(block.hash)) return unavailable("aave_block_unavailable");
    const observedAtMs = Number(block.timestamp) * 1000;
    const nowMs = (options.now ?? new Date()).getTime();
    if (!Number.isSafeInteger(observedAtMs) || !Number.isFinite(nowMs) || observedAtMs > nowMs || nowMs - observedAtMs > 300_000)
      return unavailable("aave_snapshot_stale");
    const read = (target: Address, functionName: string, args: readonly unknown[] = []): Promise<unknown> =>
      client.readContract({ address: target, abi, functionName, args, blockHash: block.hash, requireCanonical: true } as never);
    stage = "market";
    const pool = await read(AAVE_BASE_PROTOCOL.provider, "getPool");
    const dataProvider = await read(AAVE_BASE_PROTOCOL.provider, "getPoolDataProvider");
    if (address(pool) !== AAVE_BASE_V3_MARKET.toLowerCase() || address(dataProvider) !== AAVE_BASE_PROTOCOL.dataProvider.toLowerCase())
      return unavailable("aave_market_changed");
    stage = "reserves";
    const reserves = await read(AAVE_BASE_V3_MARKET, "getReservesList");
    if (!Array.isArray(reserves) || !reserves.length || reserves.length > 128
      || reserves.some((reserve) => !address(reserve) || address(reserve) === `0x${"0".repeat(40)}`)
      || new Set(reserves.map((reserve) => address(reserve))).size !== reserves.length) return unavailable("aave_reserve_coverage_incomplete", "partial");
    stage = "positions";
    const calls = reserves.map((reserve) => ({ target: AAVE_BASE_PROTOCOL.dataProvider, allowFailure: true,
      callData: encodeFunctionData({ abi, functionName: "getUserReserveData", args: [reserve as Address, accountId.slice(5) as Address] }) }));
    const batch = await read(MULTICALL3, "aggregate3", [calls]);
    if (!Array.isArray(batch) || batch.length !== reserves.length || batch.some((item) => !item || item.success !== true || typeof item.returnData !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(item.returnData)))
      return unavailable("aave_reserve_coverage_incomplete", "partial");
    const balances = reserves.map((reserve, index) => {
      const position = decodeFunctionResult({ abi, functionName: "getUserReserveData", data: batch[index].returnData as `0x${string}` });
      if (!Array.isArray(position) || position.length !== 9 || position.slice(0, 3).some((value) => typeof value !== "bigint" || value < 0n))
        throw new Error("Incomplete Aave reserve position.");
      const supplied = position[0] as bigint;
      const borrowed = (position[1] as bigint) + (position[2] as bigint);
      return { reserve, supplied, borrowed };
    }).filter(({ supplied, borrowed }) => supplied || borrowed);
    stage = "configurations";
    const configCalls = balances.map(({ reserve }) => ({ target: AAVE_BASE_PROTOCOL.dataProvider, allowFailure: true,
      callData: encodeFunctionData({ abi, functionName: "getReserveConfigurationData", args: [reserve as Address] }) }));
    const configurations = configCalls.length ? await read(MULTICALL3, "aggregate3", [configCalls]) : [];
    if (!Array.isArray(configurations) || configurations.length !== balances.length || configurations.some((item) => !item || item.success !== true || typeof item.returnData !== "string" || !/^0x(?:[0-9a-f]{2})*$/i.test(item.returnData)))
      return unavailable("aave_reserve_coverage_incomplete", "partial");
    const positions = balances.map(({ reserve, supplied, borrowed }, index) => {
      const config = decodeFunctionResult({ abi, functionName: "getReserveConfigurationData", data: configurations[index].returnData as `0x${string}` });
      if (!Array.isArray(config) || config.length !== 10 || typeof config[0] !== "bigint" || config[0] < 0n || config[0] > 36n)
        throw new Error("Incomplete Aave reserve precision.");
      const decimals = Number(config[0]);
      const common = { assetId: `8453:${address(reserve)}`, decimals, market: AAVE_BASE_V3_MARKET.toLowerCase(),
        observedAt: new Date(observedAtMs).toISOString(), sourceId: SOURCE_ID };
      return [
        ...(supplied ? [{ ...common, side: "supply" as const, rawUnits: supplied.toString() }] : []),
        ...(borrowed ? [{ ...common, side: "debt" as const, rawUnits: `-${borrowed}` }] : [])
      ];
    });
    stage = "canonical";
    const canonical = await client.getBlock({ blockNumber: block.number });
    if (canonical.hash?.toLowerCase() !== block.hash.toLowerCase() || canonical.timestamp !== block.timestamp)
      return unavailable("aave_block_changed");
    if ((options.now ?? new Date()).getTime() - observedAtMs > 300_000)
      return unavailable("aave_snapshot_stale");
    legs.push(...positions.flat());
    return { legs, status: "complete", reason: null };
  } catch (error) {
    console.warn(JSON.stringify({ event: "portfolio.aave.current.failed", stage, errorName: error instanceof Error ? error.name : "unknown" }));
    return unavailable("aave_unavailable");
  }
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
      const finalized = proof.blockHash?.toLowerCase() === blockHash && proof.finalized && proof.receiptSuccess
        && proof.blockTimestamp !== undefined && BigInt(Date.parse(occurredAt)) === proof.blockTimestamp * 1000n
        && Array.isArray(proof.logs) && proof.logs.some((log) => matchesPoolEvent(log, kind, reserve.assetId.slice(5), input.accountId.slice(5), amount, logIndex as number));
      if (!finalized) return partial(events);
      if (occurredAt < input.from || occurredAt >= input.through) continue;
      events.push({ sourceId: SOURCE_ID, sourceName: "Aave V3 Base", sourceEventId: id, ingestionVersion: 3, accountId: input.accountId, assetId: reserve.assetId, rawDelta: kind === "redeem" || kind === "borrow" ? `-${amount}` : amount, decimals: reserve.decimals, kind, occurredAt, chainId: 8453, blockNumber, blockHash, txHash, logIndex: logIndex as number, finality: "finalized", completeness: "complete", groupId: txHash, counterpartyAccountId: null, evidenceJson: JSON.stringify({ sourceEvidenceVersion: 3, effectProof: "canonical_aave_pool_log", market: AAVE_BASE_V3_MARKET, type: row.__typename, role: "protocol_activity" }) });
    }
    const complete = !info.hasNextPage;
    return { events, nextCursor: complete ? null : info.next as string, coveredThrough: complete ? input.through : input.from, complete, sourceId: SOURCE_ID };
  }

  private async verifyRpc(txHash: `0x${string}`, blockNumber: bigint): ReturnType<Verify> {
    const client = createPublicClient({ chain: base, transport: http() });
    const [receipt, block, tip] = await Promise.all([client.getTransactionReceipt({ hash: txHash }), client.getBlock({ blockNumber }), client.getBlockNumber()]);
    return { blockHash: block.hash, blockTimestamp: block.timestamp, receiptSuccess: receipt.status === "success" && receipt.blockHash === block.hash && receipt.blockNumber === blockNumber && receipt.transactionHash.toLowerCase() === txHash,
      finalized: tip >= blockNumber + (this.options.confirmationDepth ?? 20n), logs: receipt.logs };
  }
}
