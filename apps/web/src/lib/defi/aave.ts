import { z } from "zod";

const AAVE_MCP_URL = "https://mcp.aave.com/";
export const AAVE_BASE_V3_MARKET = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const AAVE_BASE_ASSETS = {
  USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
  WETH: "0x4200000000000000000000000000000000000006"
} as const;

const mcpEnvelopeSchema = z.object({
  result: z.object({ structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).optional(),
  error: z.object({ message: z.string() }).optional()
});

export async function callAaveTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(AAVE_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Aurel/1.0" },
    body: JSON.stringify({ jsonrpc: "2.0", id: crypto.randomUUID(), method: "tools/call", params: { name, arguments: args } }),
    signal: AbortSignal.timeout(12_000)
  });
  if (!response.ok) throw new Error(`Aave data service returned ${response.status}.`);
  const envelope = mcpEnvelopeSchema.parse(await response.json());
  if (envelope.error) throw new Error(envelope.error.message);
  if (envelope.result?.structuredContent !== undefined) return envelope.result.structuredContent as T;
  const text = envelope.result?.content?.find((item) => item.type === "text")?.text;
  if (!text) throw new Error("Aave returned no structured result.");
  return JSON.parse(text) as T;
}

export type AaveBaseReserve = {
  symbol: "USDC" | "WETH";
  underlyingToken: string;
  supplyApyPct: string;
  borrowApyPct: string;
  totalSuppliedUsd: string;
  canSupply: boolean;
  canBorrow: boolean;
  availableLiquidity: { value: string; usd: string };
  walletBalance?: string;
};

export async function getAaveBaseMarkets(user?: string) {
  const result = await callAaveTool<{ data: { v3: { markets: Array<{ market: string; chainId: number; name: string; reserves: AaveBaseReserve[] }> } } }>("get_markets", {
    version: "v3",
    chainId: 8453,
    symbols: ["USDC", "WETH"],
    ...(user ? { user } : {})
  });
  const market = result.data.v3.markets.find((item) => item.market.toLowerCase() === AAVE_BASE_V3_MARKET.toLowerCase());
  if (!market) throw new Error("The governed Aave Base market is unavailable.");
  return { ...market, observedAt: new Date().toISOString(), authority: "Aave Protocol API and Base contracts" as const };
}

export async function getAaveBasePosition(user: string) {
  const [positions, summary] = await Promise.all([
    callAaveTool<unknown>("get_user_positions", { user, version: "v3", chainId: 8453 }),
    callAaveTool<unknown>("get_user_summary", { user, version: "v3", chainId: 8453 })
  ]);
  return { positions, summary, overview: normalizeAavePosition(positions, summary), observedAt: new Date().toISOString(), authority: "Aave Protocol API and Base contracts" as const };
}

function recordAt(value: unknown, path: string[]): Record<string, unknown> | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current && typeof current === "object" && !Array.isArray(current) ? current as Record<string, unknown> : undefined;
}

function firstScalar(value: unknown, names: Set<string>): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  if (Array.isArray(value)) {
    for (const item of value) { const found = firstScalar(item, names); if (found !== undefined) return found; }
    return undefined;
  }
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    if (names.has(key) && (typeof child === "string" || typeof child === "number")) return String(child);
  }
  for (const child of Object.values(value as Record<string, unknown>)) { const found = firstScalar(child, names); if (found !== undefined) return found; }
  return undefined;
}

export function normalizeAavePosition(positions: unknown, summary: unknown) {
  const positionRoot = recordAt(positions, ["data", "v3"]);
  const summaryRoot = recordAt(summary, ["data", "v3"]);
  const supplies = Array.isArray(positionRoot?.supplies) ? positionRoot.supplies : [];
  const borrows = Array.isArray(positionRoot?.borrows) ? positionRoot.borrows : [];
  const markets = Array.isArray(summaryRoot?.markets) ? summaryRoot.markets : [];
  const marketsWithPosition = typeof summaryRoot?.marketsWithPosition === "number" ? summaryRoot.marketsWithPosition : markets.length;
  return {
    marketsWithPosition,
    supplyGroups: supplies.length,
    borrowGroups: borrows.length,
    healthFactor: firstScalar(summaryRoot, new Set(["healthFactor", "health_factor"])),
    netWorthUsd: firstScalar(summaryRoot, new Set(["netWorthUSD", "netWorthUsd", "net_worth_usd"])),
    rewardsStatus: "not_reported" as const
  };
}

export type AaveAction = "supply" | "borrow" | "withdraw" | "repay";

export async function prepareAaveBaseAction(input: { action: AaveAction; sender: string; symbol: keyof typeof AAVE_BASE_ASSETS; amount?: string; max?: boolean; enableCollateral?: boolean }) {
  const args = {
    action: input.action,
    version: "v3",
    sender: input.sender,
    market: AAVE_BASE_V3_MARKET,
    token: AAVE_BASE_ASSETS[input.symbol],
    chainId: 8453,
    ...(input.amount ? { amount: input.amount } : {}),
    ...(input.max ? { max: true } : {}),
    ...(input.action === "supply" ? { enableCollateral: Boolean(input.enableCollateral) } : {})
  };
  const preview = await callAaveTool<unknown>("preview_action", args);
  const plan = await callAaveTool<unknown>("prepare_action", args);
  return { preview, plan, preparedAt: new Date().toISOString(), authority: "Aave Protocol API" as const };
}
