export function initialMarkets(): unknown;
export function handleMarkets(input: unknown): boolean;
export function perpPosition(input: { coin: string; size: string; entryPx: string; positionValue: string; unrealizedPnl: string; leverage?: number;
  liquidationPx?: string | null; marginUsed: string }): Record<string, unknown>;
export function predictionPosition(input: { id: number; title?: string; outcomeIndex?: 0 | 1; size: number; avgPrice: number; currentPrice: number;
  redeemable?: boolean }): Record<string, unknown>;
export const FAKE_FILL_TIME: number;
