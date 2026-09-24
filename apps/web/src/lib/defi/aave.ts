import { z } from "zod";

const AAVE_MCP_URL = "https://mcp.aave.com/";
export const AAVE_BASE_V3_MARKET = "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
export const AAVE_BASE_PROTOCOL = {
  provider: "0xe20fCBdBfFC4Dd138cE8b2E6FBb6CB49777ad64D",
  dataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
  oracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156"
} as const;
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

export async function getAaveBasePosition(user: string) {
  const [positions, summary, rewards] = await Promise.all([
    callAaveTool<unknown>("get_user_positions", { user, version: "v3", chainId: 8453 }),
    callAaveTool<unknown>("get_user_summary", { user, version: "v3", chainId: 8453 }),
    callAaveTool<unknown>("get_user_rewards", { user, version: "v3" }).catch(() => null)
  ]);
  return {
    overview: normalizeAavePosition(positions, summary),
    rewards: normalizeAaveBaseRewards(rewards),
    observedAt: new Date().toISOString(),
    authority: "Aave Protocol API and Base contracts" as const
  };
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
  destination: "Aave V3";
  source: "Aave V3";
  sourceKind: "chain";
  authority: "Aave Protocol API and Base";
  events: Array<{ type: "intent_confirmed"; occurredAt: string }>;
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
      estimatedUsd: estimatedUsd !== undefined && Number.isFinite(estimatedUsd) ? estimatedUsd : undefined,
      destination: "Aave V3",
      source: "Aave V3",
      sourceKind: "chain",
      authority: "Aave Protocol API and Base",
      events: [{ type: "intent_confirmed", occurredAt: createdAt }]
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

export function normalizeAavePosition(positions: unknown, summary: unknown) {
  const positionRoot = recordAt(positions, ["data", "v3"]);
  const summaryRoot = recordAt(summary, ["data", "v3"]);
  if (!Array.isArray(positionRoot?.supplies) || !Array.isArray(positionRoot?.borrows) || !Array.isArray(summaryRoot?.markets))
    throw new Error("Incomplete Aave position response.");
  const supplies = positionRoot.supplies;
  const borrows = positionRoot.borrows;
  const markets = summaryRoot.markets;
  const debts = borrows.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)
    && String((item as Record<string, unknown>).market).toLowerCase() === AAVE_BASE_V3_MARKET.toLowerCase()).map((item) => {
    if (typeof item.symbol !== "string" || typeof item.balance !== "string" || typeof item.balanceUsd !== "string"
      || !/^\d+(?:\.\d+)?$/.test(item.balance) || !/^\d+(?:\.\d+)?$/.test(item.balanceUsd))
      throw new Error("Incomplete Aave debt response.");
    return { symbol: item.symbol, amount: item.balance, usd: item.balanceUsd };
  });
  const marketsWithPosition = typeof summaryRoot?.marketsWithPosition === "number" ? summaryRoot.marketsWithPosition : markets.length;
  return {
    marketsWithPosition,
    supplyGroups: supplies.length,
    borrowGroups: borrows.length,
    debts,
    healthFactor: firstScalar(summaryRoot, new Set(["healthFactor", "health_factor"])),
    netWorthUsd: firstScalar(summaryRoot, new Set(["netWorthUSD", "netWorthUsd", "net_worth_usd"]))
  };
}

export type AaveReward = {
  symbol: string;
  name: string;
  amount: string;
  usd: string;
  tokenAddress: string;
};

export type AaveBaseRewards = {
  items: AaveReward[];
  totalUsd: string;
  partial: boolean;
  claimAvailable: boolean;
  sourceStatus: "available" | "none" | "unavailable";
};

function rewardRows(value: unknown) {
  const root = recordAt(value, ["data", "v3"]);
  const rewards = Array.isArray(root?.rewards) ? root.rewards : [];
  return { root, rewards: rewards.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === "object" && !Array.isArray(item)) };
}

export function normalizeAaveBaseRewards(value: unknown): AaveBaseRewards {
  if (value === null || value === undefined) return { items: [], totalUsd: "0", partial: false, claimAvailable: false, sourceStatus: "unavailable" };
  const { root, rewards } = rewardRows(value);
  const base = rewards.find((item) => Number(item.chainId ?? item.chain) === 8453);
  const claimable = Array.isArray(base?.claimable) ? base.claimable : [];
  const items = claimable.flatMap((item): AaveReward[] => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const amount = record.amount && typeof record.amount === "object" && !Array.isArray(record.amount) ? record.amount as Record<string, unknown> : undefined;
    const decimal = amount?.amount && typeof amount.amount === "object" && !Array.isArray(amount.amount) ? amount.amount as Record<string, unknown> : undefined;
    const currency = record.currency && typeof record.currency === "object" && !Array.isArray(record.currency) ? record.currency as Record<string, unknown> : undefined;
    if (!currency || typeof currency.symbol !== "string" || typeof currency.address !== "string" || typeof decimal?.value !== "string") return [];
    return [{
      symbol: currency.symbol,
      name: typeof currency.name === "string" ? currency.name : currency.symbol,
      amount: decimal.value,
      usd: typeof amount?.usd === "string" ? amount.usd : "0",
      tokenAddress: currency.address
    }];
  });
  const totalUsd = items.reduce((sum, item) => sum + (Number(item.usd) || 0), 0);
  const transaction = base?.transaction && typeof base.transaction === "object" && !Array.isArray(base.transaction) ? base.transaction as Record<string, unknown> : undefined;
  return {
    items,
    totalUsd: totalUsd.toFixed(8).replace(/\.?0+$/, "") || "0",
    partial: Boolean(root?.partial),
    claimAvailable: items.length > 0 && Boolean(transaction),
    sourceStatus: items.length > 0 ? "available" : "none"
  };
}

const rewardTransactionSchema = z.object({
  to: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  from: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  data: z.string().regex(/^0x[a-fA-F0-9]+$/),
  value: z.literal("0"),
  chainId: z.literal(8453)
});

export async function getAaveBaseRewardClaimPlan(user: string) {
  const result = await callAaveTool<unknown>("get_user_rewards", { user, version: "v3" });
  const normalized = normalizeAaveBaseRewards(result);
  const { rewards } = rewardRows(result);
  const base = rewards.find((item) => Number(item.chainId ?? item.chain) === 8453);
  const transaction = rewardTransactionSchema.parse(base?.transaction);
  if (transaction.from.toLowerCase() !== user.toLowerCase()) throw new Error("Aave returned a reward transaction for another wallet.");
  if (!normalized.claimAvailable) throw new Error("No claimable Base rewards are currently available.");
  return { rewards: normalized, transaction, preparedAt: new Date().toISOString(), authority: "Aave Protocol API" as const };
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
    ...(input.max ? { max: true } : {})
  };
  const preview = await callAaveTool<unknown>("preview_action", args);
  const plan = await callAaveTool<unknown>("prepare_action", {
    ...args,
    ...(input.action === "supply" ? { enableCollateral: Boolean(input.enableCollateral) } : {})
  });
  return { preview, plan, preparedAt: new Date().toISOString(), authority: "Aave Protocol API" as const };
}
