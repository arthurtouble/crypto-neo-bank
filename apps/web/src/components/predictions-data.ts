"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/client/auth";
import { ApiError, useApi } from "@/lib/client/api";
import { examplePredictionEvents, exampleUpOrDownEvents } from "@/lib/example/markets";
import { mergeTicks, predictionErrorCopy, PRICE_STREAM_URL, priceStreamSubscription, streamTicks, type Tick } from "@/lib/markets/predictions-view";
import { useUpOrDown, type PolymarketEvent, type PredictionMarketView } from "./markets-data";
import { failureMessage } from "./markets-parts";

/**
 * What only the predictions screens read: the event list with search and
 * more pages, the live price an Up or Down market settles on, a ticking
 * clock for countdowns, and failures in plain words. Shared reads (a market,
 * the account, odds history) stay in markets-data.ts.
 */

/** A prediction market's page. The route shell renders `PredictionMarketPage` with this id. */
export const predictionHref = (id: string, outcome?: 0 | 1) => `/app/predictions/${encodeURIComponent(id)}${outcome === undefined ? "" : `?outcome=${outcome}`}`;
/** The predictions home. */
export const PREDICTIONS_HREF = "/app/predictions";

/**
 * `/api/predictions/markets/[id]`, and what an Up or Down market adds when
 * the server sends it: its window and the price to beat (see
 * docs/architecture/markets.md, "Up or Down").
 */
export type PredictionMarketDetail = PredictionMarketView & { upOrDown?: { window: string | null; priceToBeat: number | null } | null };

type EventPage = { events: PolymarketEvent[]; nextCursor: string | null };

/**
 * Open events, 20 a page, for a category tag, a search, or (with `upOrDown`)
 * the short crypto markets in one window. Guests get the labelled examples,
 * filtered the same way.
 */
export function usePredictionEventList(input: { tag: string | null; search: string; upOrDown: boolean; window: string | null }) {
  const { ready, authenticated, user } = useAuth();
  const api = useApi();
  const live = ready && authenticated;
  const search = input.search.trim();
  const params = new URLSearchParams();
  if (input.upOrDown) { if (input.window) params.set("window", input.window); }
  else { if (input.tag) params.set("category", input.tag); if (search) params.set("search", search); }
  const path = input.upOrDown ? "/api/predictions/up-or-down" : "/api/predictions/events";
  const query = useInfiniteQuery({
    queryKey: ["prediction-event-list", path, params.toString(), user?.id],
    queryFn: ({ pageParam }) => {
      const page = new URLSearchParams(params);
      if (pageParam) page.set("cursor", pageParam);
      const text = page.toString();
      return api<EventPage>(`${path}${text ? `?${text}` : ""}`);
    },
    initialPageParam: null as string | null,
    getNextPageParam: (last) => last.nextCursor,
    enabled: live,
    refetchInterval: input.upOrDown ? 15_000 : 30_000,
    retry: (count, error) => !(error instanceof ApiError && (error.code === "feature_unavailable" || error.status === 404 || error.status === 400)) && count < 2
  });
  if (!live) {
    const words = search.toLowerCase();
    const events = input.upOrDown
      ? exampleUpOrDownEvents.filter((event) => !input.window || event.upOrDown?.window === input.window)
      : examplePredictionEvents.filter((event) => (!input.tag || event.tags.some((tag) => tag.slug === input.tag)) && (!words || event.title.toLowerCase().includes(words)));
    return { events: ready ? events : undefined, isExample: ready, isPending: !ready, error: null, switchedOff: false, hasMore: false,
      loadingMore: false, loadMore: () => undefined, refetch: () => undefined };
  }
  return {
    events: query.data?.pages.flatMap((page) => page.events),
    isExample: false,
    isPending: query.isPending,
    error: query.error,
    switchedOff: query.error instanceof ApiError && query.error.code === "feature_unavailable",
    hasMore: query.hasNextPage,
    loadingMore: query.isFetchingNextPage,
    loadMore: () => void query.fetchNextPage(),
    refetch: () => void query.refetch()
  };
}

/**
 * The Up or Down event a market belongs to, from the soonest-ending list,
 * for the price to beat Polymarket publishes on the event. Null for any other
 * market, or one the list no longer carries.
 */
export function useUpOrDownEvent(marketId: string | null, enabled: boolean): PolymarketEvent | null {
  const list = useUpOrDown(enabled && marketId !== null);
  if (!marketId || !list.data) return null;
  return list.data.events.find((event) => event.markets.some((market) => market.id === marketId)) ?? null;
}

/** The time now, moving every `everyMs` (a second by default), for countdowns. */
export function useNow(everyMs = 1_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), everyMs);
    return () => clearInterval(timer);
  }, [everyMs]);
  return now;
}

export type PriceStream = {
  ticks: Tick[];
  /** connecting: no tick yet; live: a tick in the last 15 seconds; stale: none since; unavailable: the stream can't be reached. */
  status: "connecting" | "live" | "stale" | "unavailable";
  /** When the last tick arrived, in this browser's clock. */
  lastAt: number | null;
};

/** After this long without a tick, the price shows as unavailable rather than the last one. */
export const STREAM_STALE_MS = 15_000;
const MAX_RECONNECTS = 3;

/**
 * The live Chainlink price of `symbol` ("btc"), streamed straight from
 * Polymarket's real-time data socket: about a minute of ticks on connecting,
 * then one a second. After three failed connections it says unavailable,
 * and keeps trying every 15 seconds. With
 * `example`, a made-up price moves around it instead, for guests.
 */
export function usePriceStream(symbol: string | null, options: { since: number; example?: number | null }): PriceStream {
  const example = options.example ?? null;
  const key = example !== null ? `example:${example}` : symbol ?? "";
  // Everything read for one stream, kept with its key so a new symbol starts empty without a reset in the effect.
  const [state, setState] = useState<{ key: string; ticks: Tick[]; lastAt: number | null; failed: boolean }>({ key, ticks: [], lastAt: null, failed: false });
  const since = useRef(options.since);
  useEffect(() => { since.current = options.since; }, [options.since]);
  const now = useNow(1_000);

  useEffect(() => {
    const add = (incoming: Tick[], keep: number) => setState((current) => ({
      key, ticks: mergeTicks(current.key === key ? current.ticks : [], incoming, keep), lastAt: Date.now(), failed: false
    }));
    const failed = () => setState((current) => ({ ...(current.key === key ? current : { key, ticks: [], lastAt: null }), failed: true }));
    if (example !== null) {
      const wave = (time: number) => example * (1 + 0.0009 * Math.sin(time / 41_000) + 0.0004 * Math.sin(time / 9_000));
      const second = () => Math.floor(Date.now() / 1000) * 1000;
      const first = setTimeout(() => add(Array.from({ length: 120 }, (_, index) => { const time = second() - (119 - index) * 1000; return { time, price: wave(time) }; }), 0), 0);
      const timer = setInterval(() => { const time = second(); add([{ time, price: wave(time) }], time - 15 * 60_000); }, 1_000);
      return () => { clearTimeout(first); clearInterval(timer); };
    }
    if (!symbol) return;
    let socket: WebSocket | null = null, ping: ReturnType<typeof setInterval> | undefined, retry: ReturnType<typeof setTimeout> | undefined;
    let attempts = 0, stopped = false;
    const connect = () => {
      try { socket = new WebSocket(PRICE_STREAM_URL); } catch { failed(); return; }
      socket.onopen = () => {
        socket?.send(priceStreamSubscription(symbol));
        ping = setInterval(() => { if (socket?.readyState === WebSocket.OPEN) socket.send("PING"); }, 5_000);
      };
      socket.onmessage = (event) => {
        const incoming = streamTicks(event.data, symbol);
        if (incoming.length === 0) return;
        attempts = 0;
        add(incoming, since.current);
      };
      socket.onclose = () => {
        clearInterval(ping);
        if (stopped) return;
        attempts += 1;
        // After a few quick tries the price shows as unavailable; it keeps trying, less often, and comes back on the next tick.
        if (attempts > MAX_RECONNECTS) failed();
        retry = setTimeout(connect, attempts > MAX_RECONNECTS ? 15_000 : 500 * 2 ** attempts);
      };
    };
    connect();
    return () => { stopped = true; clearInterval(ping); clearTimeout(retry); socket?.close(); };
  }, [key, symbol, example]);

  const current = state.key === key ? state : { ticks: [], lastAt: null, failed: false };
  const { ticks, lastAt } = current;
  const status = !symbol && example === null ? "unavailable"
    : current.failed && (lastAt === null || now - lastAt > STREAM_STALE_MS) ? "unavailable"
      : lastAt === null ? "connecting" : now - lastAt > STREAM_STALE_MS ? "stale" : "live";
  return { ticks, status, lastAt };
}

/** A failed step in words a customer can act on: the server's code mapped to plain copy, a cancelled passkey, or the server's own sentence. */
export function predictionErrorMessage(error: unknown): string {
  if (error instanceof ApiError) return predictionErrorCopy(error.code, error.message);
  return failureMessage(error);
}

/** What can't be loaded on the predictions account, in words, said next to it. */
export function unavailableReason(what: "cash" | "positions" | "orders"): string {
  return what === "cash" ? "Your predictions cash can't be loaded right now."
    : what === "positions" ? "Your positions can't be loaded from Polymarket right now." : "Your open orders can't be loaded from Polymarket right now.";
}
