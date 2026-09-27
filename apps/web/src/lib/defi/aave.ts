import { z } from "zod";

import { localEdgeUrl } from "@/lib/testing/local-edge";

const AAVE_MCP_URL = "https://mcp.aave.com/";
import { AAVE_BASE_V3_MARKET } from "./aave-contracts";

export { AAVE_BASE_ASSETS, AAVE_BASE_PROTOCOL, AAVE_BASE_V3_MARKET } from "./aave-contracts";

const mcpEnvelopeSchema = z.object({
  result: z.object({ structuredContent: z.unknown().optional(), content: z.array(z.object({ type: z.string(), text: z.string().optional() })).optional() }).optional(),
  error: z.object({ message: z.string() }).optional()
});

export async function callAaveTool<T>(name: string, args: Record<string, unknown>): Promise<T> {
  const response = await fetch(localEdgeUrl("AAVE_API_URL") ?? AAVE_MCP_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": "Aura/1.0" },
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

export type AaveBaseActivityItem = {
  id: string;
  type: "earn_supply" | "earn_withdraw" | "borrow" | "repay" | "liquidation" | "collateral_enabled" | "collateral_disabled" | "defi_activity";
  status: "confirmed";
  transactionHash: string;
  createdAt: string;
  chainId: 8453;
  asset?: string;
  amount?: string;
  estimatedUsd?: number;
};

export type AaveBaseActivity = {
  items: AaveBaseActivityItem[];
  partial: boolean;
  nextCursor?: string;
  sourceStatus: "available" | "none" | "unavailable";
};

function activityType(typeName: string, enabled?: boolean): AaveBaseActivityItem["type"] {
  const normalized = typeName.toLowerCase();
  if (normalized.includes("collateral")) return enabled === false ? "collateral_disabled" : "collateral_enabled";
  if (normalized.includes("liquidation")) return "liquidation";
  if (normalized.includes("repay")) return "repay";
  if (normalized.includes("borrow")) return "borrow";
  if (normalized.includes("withdraw") || normalized.includes("redeem")) return "earn_withdraw";
  if (normalized.includes("supply") || normalized.includes("deposit")) return "earn_supply";
  return "defi_activity";
}

function amountValue(value: unknown): string | undefined {
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  return firstScalar(value, new Set(["value", "amount"]));
}

export function normalizeAaveBaseActivity(value: unknown): AaveBaseActivity {
  if (value === null || value === undefined) return { items: [], partial: false, sourceStatus: "unavailable" };
  const root = recordAt(value, ["data", "v3"]);
  const rawItems = Array.isArray(root?.items) ? root.items : [];
  const items = rawItems.flatMap((item): AaveBaseActivityItem[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const transactionHash = typeof record.txHash === "string" && /^0x[a-fA-F0-9]{64}$/.test(record.txHash) ? record.txHash : undefined;
    const createdAt = typeof record.timestamp === "string" && Number.isFinite(Date.parse(record.timestamp)) ? new Date(record.timestamp).toISOString() : undefined;
    if (!transactionHash || !createdAt) return [];
    const reserve = record.reserve && typeof record.reserve === "object" && !Array.isArray(record.reserve) ? record.reserve as Record<string, unknown> : undefined;
    const amount = amountValue(record.amount);
    const priceUsd = amountValue(record.assetPriceUSD ?? record.assetPriceUsd);
    const estimatedUsd = amount && priceUsd && Number.isFinite(Number(amount)) && Number.isFinite(Number(priceUsd)) ? Number(amount) * Number(priceUsd) : undefined;
    const typeName = typeof record.__typename === "string" ? record.__typename : "AaveActivity";
    const type = activityType(typeName, typeof record.enabled === "boolean" ? record.enabled : undefined);
    return [{
      id: `aave:${transactionHash}:${type}`,
      type,
      status: "confirmed",
      transactionHash,
      createdAt,
      chainId: 8453,
      asset: typeof reserve?.symbol === "string" ? reserve.symbol : undefined,
      amount,
      estimatedUsd: estimatedUsd !== undefined && Number.isFinite(estimatedUsd) ? estimatedUsd : undefined
    }];
  });
  const pageInfo = root?.pageInfo && typeof root.pageInfo === "object" && !Array.isArray(root.pageInfo) ? root.pageInfo as Record<string, unknown> : undefined;
  return {
    items,
    partial: Boolean(root?.partial) || typeof pageInfo?.next === "string",
    nextCursor: typeof pageInfo?.next === "string" ? pageInfo.next : undefined,
    sourceStatus: items.length ? "available" : "none"
  };
}

export async function getAaveBaseActivity(user: string) {
  const result = await callAaveTool<unknown>("get_user_activity", { user, version: "v3", chainId: 8453 });
  return normalizeAaveBaseActivity(result);
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
