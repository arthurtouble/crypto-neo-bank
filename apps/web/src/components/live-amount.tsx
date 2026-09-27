"use client";

import { useEffect, useState } from "react";

const YEAR_MS = 365 * 24 * 3600 * 1000;

/** What an amount observed at `observedAt` grows to by `now`, compounding at `apyPct` a year. */
export function grownAmount(amount: number, apyPct: number, observedAt: string, now: number): number {
  const elapsed = Math.max(0, now - Date.parse(observedAt));
  return amount * Math.pow(1 + apyPct / 100, elapsed / YEAR_MS);
}

/**
 * A position's dollar value as precisely as it was read: a USDC position is
 * its exact token amount (USDC counts at $1); anything else is its value in cents.
 */
export function positionUsd(holding: { symbol: string; amountRaw: string | null; decimals: number; usdCents: number | null }): number | null {
  if (holding.symbol === "USDC" && holding.amountRaw !== null) return Number(holding.amountRaw) / 10 ** holding.decimals;
  return holding.usdCents === null ? null : holding.usdCents / 100;
}

/**
 * An Earn position in dollars, growing in real time at its yearly rate from
 * the last value read from the chain. Each new read replaces the starting
 * point, so the number never drifts from the chain; between reads it shows
 * interest as it accrues, to 8 decimals.
 */
export function LiveAmount({ usd, apyPct, observedAt }: { usd: number; apyPct: number | undefined; observedAt: string }) {
  const [now, setNow] = useState(() => Date.now());
  const live = apyPct !== undefined && apyPct > 0 && usd > 0;
  useEffect(() => {
    if (!live) return;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [live]);
  const value = live ? grownAmount(usd, apyPct, observedAt, now) : usd;
  return <span className="liveAmount" data-live={live ? "true" : undefined}>
    ${value.toLocaleString("en-US", { minimumFractionDigits: live ? 8 : 2, maximumFractionDigits: live ? 8 : 2 })}
  </span>;
}
