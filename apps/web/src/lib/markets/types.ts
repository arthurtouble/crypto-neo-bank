/**
 * Shared shapes for the markets Aura connects customers to (Hyperliquid perps,
 * Polymarket predictions). Aura is a front end: the customer's own wallet owns
 * every venue account, and balances, positions, and orders are read from the
 * venue each time, never kept in D1 as proof of anything.
 */

export type Venue = "hyperliquid" | "polymarket";

/** EIP-712 typed data as JSON: numbers that may exceed 2^53 are decimal strings, bytes are 0x hex. */
export type TypedData = {
  domain: Record<string, string | number>;
  types: Record<string, Array<{ name: string; type: string }>>;
  primaryType: string;
  message: Record<string, unknown>;
};

/** A read from a venue, with where it came from and when. A failed read is unavailable, never the last value. */
export type Observed<T> =
  | { status: "observed"; source: Venue; observedAt: string; data: T }
  | { status: "unavailable"; source: Venue; observedAt: string; reason: string };

export class VenueError extends Error {
  constructor(readonly venue: Venue, readonly code: string, message: string, readonly status = 502) {
    super(message);
    this.name = "VenueError";
  }
}
