import { AAVE_BASE_PROTOCOL } from "@/lib/defi/aave";
import { resolveHistoricalAaveBlock, verifyHistoricalAaveBlock } from "@/lib/portfolio/aave-history";
import { createPublicClient, decodeFunctionResult, encodeFunctionData, http, parseAbi, type Address, type PublicClient } from "viem";
import { base } from "viem/chains";

const MULTICALL3 = "0xcA11bde05977b3631167028862bE2a173976CA11";
const ABI = parseAbi([
  "function getPool() view returns (address)",
  "function getPoolDataProvider() view returns (address)",
  "function getReservesList() view returns (address[])",
  "function getUserReserveData(address asset,address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
  "function getReserveConfigurationData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)",
  "function aggregate3((address target,bool allowFailure,bytes callData)[] calls) payable returns ((bool success,bytes returnData)[])"
]);

type Leg = { assetId: string; side: "supply" | "debt"; rawUnits: string; decimals: number };
type Result = { status: "complete" | "unavailable"; day: string; legs: Leg[]; reason: string | null; blockNumber?: string; blockHash?: string; pool?: string; dataProvider?: string };
type Options = { client?: PublicClient; now?: Date; confirmationDepth?: bigint };
const normalizedAddress = (value: unknown): string | null => typeof value === "string" && /^0x[0-9a-f]{40}$/i.test(value) && !/^0x0{40}$/i.test(value) ? value.toLowerCase() : null;

export async function readHistoricalAaveLegs(accountId: string, day: string, options: Options = {}): Promise<Result> {
  const unavailable = (reason: string): Result => ({ status: "unavailable", day, legs: [], reason });
  if (!/^8453:0x[0-9a-f]{40}$/.test(accountId)) return unavailable("unsupported_account");
  const archiveUrl = process.env.AUREL_BASE_ARCHIVE_RPC_URL;
  let configured = false;
  try { configured = !!archiveUrl && new URL(archiveUrl).protocol === "https:"; } catch { /* No archive source. */ }
  if (!options.client && !configured) return unavailable("archive_unconfigured");
  const client: PublicClient = options.client ?? createPublicClient({ chain: base,
    transport: http(archiveUrl!, { retryCount: 0, timeout: 12_000 }) }) as PublicClient;
  const boundary = await resolveHistoricalAaveBlock(day, { ...options, client });
  if (boundary.status !== "complete") return unavailable(boundary.reason);
  const blockHash = boundary.block.hash;
  const read = (target: Address, functionName: string, args: readonly unknown[] = []): Promise<unknown> =>
    client.readContract({ address: target, abi: ABI, functionName, args, blockHash, requireCanonical: true } as never);
  let stage = "registry";
  try {
    const pool = normalizedAddress(await read(AAVE_BASE_PROTOCOL.provider, "getPool"));
    const dataProvider = normalizedAddress(await read(AAVE_BASE_PROTOCOL.provider, "getPoolDataProvider"));
    if (!pool || !dataProvider) return unavailable("historical_registry_unavailable");
    stage = "code";
    for (const target of [AAVE_BASE_PROTOCOL.provider, pool, dataProvider, MULTICALL3]) {
      const code = await client.getBytecode({ address: target as Address, blockHash } as never);
      if (!code || code === "0x") return unavailable("historical_contract_unavailable");
    }
    stage = "reserves";
    const reserves = await read(pool as Address, "getReservesList");
    if (!Array.isArray(reserves) || !reserves.length || reserves.length > 128
      || reserves.some((reserve) => !normalizedAddress(reserve))
      || new Set(reserves.map(normalizedAddress)).size !== reserves.length) return unavailable("reserve_coverage_incomplete");
    stage = "balances";
    const calls = reserves.map((reserve) => ({ target: dataProvider as Address, allowFailure: true,
      callData: encodeFunctionData({ abi: ABI, functionName: "getUserReserveData", args: [reserve as Address, accountId.slice(5) as Address] }) }));
    const batch = await read(MULTICALL3, "aggregate3", [calls]);
    if (!validBatch(batch, reserves.length)) return unavailable("reserve_coverage_incomplete");
    const balances = reserves.map((reserve, index) => {
      const decoded = decodeFunctionResult({ abi: ABI, functionName: "getUserReserveData", data: batch[index].returnData as `0x${string}` });
      if (!Array.isArray(decoded) || decoded.length !== 9 || decoded.slice(0, 3).some((value) => typeof value !== "bigint" || value < 0n)) throw new Error("Malformed reserve balance");
      return { reserve: normalizedAddress(reserve)!, supplied: decoded[0] as bigint, borrowed: (decoded[1] as bigint) + (decoded[2] as bigint) };
    }).filter((balance) => balance.supplied || balance.borrowed);
    stage = "precision";
    const configCalls = balances.map(({ reserve }) => ({ target: dataProvider as Address, allowFailure: true,
      callData: encodeFunctionData({ abi: ABI, functionName: "getReserveConfigurationData", args: [reserve as Address] }) }));
    const configs = configCalls.length ? await read(MULTICALL3, "aggregate3", [configCalls]) : [];
    if (!validBatch(configs, balances.length)) return unavailable("reserve_coverage_incomplete");
    const legs = balances.flatMap(({ reserve, supplied, borrowed }, index): Leg[] => {
      const decoded = decodeFunctionResult({ abi: ABI, functionName: "getReserveConfigurationData", data: configs[index].returnData as `0x${string}` });
      if (!Array.isArray(decoded) || decoded.length !== 10 || typeof decoded[0] !== "bigint" || decoded[0] < 0n || decoded[0] > 36n) throw new Error("Malformed reserve precision");
      const common = { assetId: `8453:${reserve}`, decimals: Number(decoded[0]) };
      return [...(supplied ? [{ ...common, side: "supply" as const, rawUnits: supplied.toString() }] : []),
        ...(borrowed ? [{ ...common, side: "debt" as const, rawUnits: `-${borrowed}` }] : [])];
    });
    stage = "canonical";
    if (!await verifyHistoricalAaveBlock(boundary, client)) return unavailable("historical_block_changed");
    return { status: "complete", day, blockNumber: boundary.block.number.toString(), blockHash, pool, dataProvider, legs, reason: null };
  } catch (error) {
    console.warn(JSON.stringify({ event: "portfolio.aave.history.failed", stage, errorName: error instanceof Error ? error.name : "unknown" }));
    return unavailable("archive_unavailable");
  }
}

function validBatch(value: unknown, length: number): value is Array<{ success: true; returnData: string }> {
  return Array.isArray(value) && value.length === length && value.every((item) => item?.success === true
    && typeof item.returnData === "string" && /^0x(?:[0-9a-f]{2})*$/i.test(item.returnData));
}
