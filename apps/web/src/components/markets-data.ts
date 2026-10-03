"use client";

import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/lib/client/auth";
import { ApiError, useApi } from "@/lib/client/api";
import { useOverview } from "@/lib/client/queries";
import { BASE_CHAIN_ID, BASE_USDC } from "@/lib/assets/registry";
import { examplePerpsAccount, examplePerpMarkets, examplePredictionEvents, examplePredictionHistory, examplePredictionsAccount,
  exampleUpOrDownEvents, examplePredictionMarket } from "@/lib/example/markets";
import type { Fill, OpenOrder as PerpOrder, PerpAccountState, PerpMarket } from "@/lib/markets/hyperliquid/info";
import type { ClobQuote, PolymarketEvent, PolymarketMarket } from "@/lib/markets/polymarket/markets";
import type { OpenOrder as PredictionOrder } from "@/lib/markets/polymarket/orders";
import type { Position as PredictionPosition } from "@/lib/markets/polymarket/positions";
import type { Observed } from "@/lib/markets/types";

/**
 * What the Markets screens read, in the shapes `/api/perps/*` and
 * `/api/predictions/*` return. Signed out, each hook answers with the
 * labelled example (`isExample`) instead, in the same shape. Every venue
 * value carries where it came from and when; a failed read is unavailable.
 */

export type { Fill, PerpAccountState, PerpMarket, PerpOrder, PolymarketEvent, PolymarketMarket, PredictionOrder, PredictionPosition, ClobQuote, Observed };

export type PerpsAccount = {
  owner: string;
  connection: { status: "pending" | "ready"; tradingKey: string | null; approvedAt: string | null } | null;
  state: Observed<PerpAccountState>;
  dexStates: Observed<PerpAccountState[]>;
  orders: Observed<PerpOrder[]>;
  fills: Observed<Fill[]>;
};

export type PredictionsAccount = {
  owner: string;
  connection: { status: "pending" | "ready"; wallet: string; approvedAt: string | null } | null;
  balance: Observed<{ raw: string; amount: string }>;
  positions: Observed<PredictionPosition[]>;
  orders: Observed<PredictionOrder[]> | null;
};

export type PredictionMarketView = { market: PolymarketMarket; quotes: ClobQuote[] | null; observedAt: string };

export type MarketQuery<T> = {
  data: T | undefined;
  isExample: boolean;
  isPending: boolean;
  error: Error | null;
  /** The venue's switch is off: the section isn't available yet. */
  switchedOff: boolean;
  refetch: () => Promise<unknown>;
};

const isSwitchedOff = (error: unknown) => error instanceof ApiError && error.code === "feature_unavailable";

function useMarketQuery<T>(key: unknown[], path: string | null, example: T, options: { refetchInterval?: number } = {}): MarketQuery<T> {
  const { ready, authenticated, user } = useAuth();
  const api = useApi();
  const live = ready && authenticated;
  const query = useQuery({
    queryKey: [...key, user?.id],
    queryFn: () => api<T>(path!),
    enabled: live && path !== null,
    refetchInterval: options.refetchInterval,
    // A switch that is off answers the same way every time; don't retry it.
    retry: (count, error) => !isSwitchedOff(error) && !(error instanceof ApiError && error.status === 404) && count < 2
  });
  if (!live) return { data: ready ? example : undefined, isExample: ready, isPending: !ready, error: null, switchedOff: false, refetch: async () => undefined };
  return { data: query.data, isExample: false, isPending: query.isPending && path !== null, error: query.error, switchedOff: isSwitchedOff(query.error), refetch: query.refetch };
}

export const usePerpMarkets = () =>
  useMarketQuery<{ markets: Observed<PerpMarket[]> }>(["perps-markets"], "/api/perps/markets", { markets: examplePerpMarkets }, { refetchInterval: 15_000 });

export const usePerpsAccount = (enabled = true) =>
  useMarketQuery<PerpsAccount>(["perps-account"], enabled ? "/api/perps/account" : null, examplePerpsAccount, { refetchInterval: 20_000 });

export const usePredictionEvents = (category: string | null) =>
  useMarketQuery<{ events: PolymarketEvent[]; nextCursor: string | null }>(["prediction-events", category ?? "all"],
    `/api/predictions/events${category ? `?category=${encodeURIComponent(category)}` : ""}`, { events: examplePredictionEvents, nextCursor: null }, { refetchInterval: 30_000 });

export const useUpOrDown = (enabled: boolean) =>
  useMarketQuery<{ events: PolymarketEvent[]; nextCursor: string | null }>(["prediction-up-or-down"], enabled ? "/api/predictions/up-or-down" : null,
    { events: exampleUpOrDownEvents, nextCursor: null }, { refetchInterval: 15_000 });

export const usePredictionMarket = (id: string) =>
  useMarketQuery<PredictionMarketView>(["prediction-market", id], `/api/predictions/markets/${encodeURIComponent(id)}`, examplePredictionMarket(id), { refetchInterval: 15_000 });

export const usePredictionHistory = (token: string | null, interval: string) =>
  useMarketQuery<{ history: Array<{ time: number; price: number }> }>(["prediction-history", token, interval],
    token ? `/api/predictions/history?token=${encodeURIComponent(token)}&interval=${interval}` : null, { history: examplePredictionHistory(interval) });

export const usePredictionsAccount = (enabled = true) =>
  useMarketQuery<PredictionsAccount>(["predictions-account"], enabled ? "/api/predictions/account" : null, examplePredictionsAccount, { refetchInterval: 20_000 });

/**
 * USDC in the Aura account on Base, which pays for trades: dollars, or null
 * while it can't be read. Guests see the example account's.
 */
export function useBaseUsdc(): { amount: number | null; observedAt: string | null; isPending: boolean } {
  const overview = useOverview();
  const holding = overview.data?.holdings.find((item) => item.id === `${BASE_CHAIN_ID}:${BASE_USDC}`);
  if (!overview.data) return { amount: null, observedAt: null, isPending: overview.isPending };
  if (!holding) return { amount: 0, observedAt: overview.data.observedAt, isPending: false };
  if (holding.status !== "observed" || holding.amountRaw === null) return { amount: null, observedAt: holding.observedAt ?? null, isPending: false };
  return { amount: Number(holding.amountRaw) / 10 ** holding.decimals, observedAt: holding.observedAt ?? overview.data.observedAt, isPending: false };
}

/** What the perps account holds across every dex, or null while any of it can't be read. */
export function perpsTotals(account: PerpsAccount | undefined): { value: number; available: number; observedAt: string } | null {
  const states = account?.dexStates;
  if (!states || states.status !== "observed") return null;
  return {
    value: states.data.reduce((sum, item) => sum + Number(item.accountValue), 0),
    available: states.data.reduce((sum, item) => sum + Number(item.withdrawable), 0),
    observedAt: states.observedAt
  };
}

/** Every open position, across dexes, or null when they can't be read. */
export function perpsPositions(account: PerpsAccount | undefined) {
  const states = account?.dexStates;
  if (!states || states.status !== "observed") return null;
  return states.data.flatMap((item) => item.positions);
}

/** The price to buy an outcome at now: the best ask, else the midpoint, else Polymarket's listed price. */
export function buyPrice(market: PolymarketMarket, quotes: ClobQuote[] | null | undefined, outcome: 0 | 1): number | null {
  const quote = quotes?.find((item) => item.tokenId === market.outcomes[outcome].tokenId);
  return quote?.bestAsk ?? quote?.mid ?? market.outcomes[outcome].price;
}
