/** Every projection records where it came from and when the provider observed it. */
export type ProjectionSource = { provider: string; observedAt: string };

export type ApplyResult =
  | { status: "applied"; projection: string }
  | { status: "stale"; projection: string }
  | { status: "ignored"; reason: "unknown_subject" | "missing_subject" | "unsupported_event" | "invalid_payload"; detail?: string };
