import { errorResponse } from "@/lib/http/route";
import { VenueError } from "./types";

/** What the customer reads for a venue's refusal; anything else shows the venue's own words. */
const COPY: Record<string, string> = {
  account_not_found: "Your perps account isn't set up yet.",
  account_not_funded: "Add money to your perps account first.",
  insufficient_margin: "You don't have enough margin for this order.",
  below_minimum: "Orders must be worth at least $10.",
  invalid_nonce: "This request is out of date. Try again.",
  no_liquidity: "There's no price for this market right now. Try again shortly.",
  unavailable: "The market isn't answering right now. Try again in a minute.",
  rate_limited: "The market is busy. Try again shortly."
};

/** A route's `onError` for venue failures: the venue's status and code, with readable copy. */
export function venueErrorResponse(error: unknown, context: { traceId: string }): Response | undefined {
  if (!(error instanceof VenueError)) return undefined;
  return errorResponse(error.status, error.code, context, { venue: error.venue, message: COPY[error.code] ?? error.message });
}
