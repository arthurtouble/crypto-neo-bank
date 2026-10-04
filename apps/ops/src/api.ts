// The web app's client-safe formatters, so both apps write money and dates the same way.
import { formatCents, formatDateTime, formatToken, formatUsd, fromRaw } from "../../web/src/lib/format";

/** An operator API answered with an error. `code` is the API's error code. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = "ApiError"; }
}

/**
 * Call an operator API. `/api/<path>` reaches the web app's `/api/ops/<path>`
 * through this app's Worker; Cloudflare Access adds the operator's token.
 */
export async function api<T>(path: string, init: { method?: "GET" | "POST" | "PATCH"; json?: unknown } = {}): Promise<T> {
  const response = await fetch(`/api/${path}`, {
    method: init.method ?? "GET", credentials: "same-origin",
    headers: init.json === undefined ? undefined : { "Content-Type": "application/json" },
    body: init.json === undefined ? undefined : JSON.stringify(init.json)
  });
  const body = await response.json().catch(() => ({})) as { error?: string; message?: string };
  if (response.ok) return body as T;
  if (response.status === 401) throw new ApiError(401, body.error ?? "unauthorized", "You're signed out of operations. Reload the page to sign in.");
  if (response.status === 403) throw new ApiError(403, body.error ?? "forbidden", body.message ?? "You don't have access to operations.");
  throw new ApiError(response.status, body.error ?? "error", body.message ?? `Something went wrong (${response.status}). Try again.`);
}

export const money = (usd: number) => formatUsd(usd);
export const cents = (value: number) => formatCents(value);
/** A raw on-chain amount, in the asset's own units: "2.5 USDC". */
export const tokens = (raw: string, decimals: number, symbol: string) => formatToken(fromRaw(raw, decimals), symbol);
export const when = (iso: string | null | undefined) => iso ? formatDateTime(iso) : "—";
export const short = (value: string) => value.length > 18 ? `${value.slice(0, 10)}…${value.slice(-6)}` : value;

/** A stored code an operator reads, in words: `stale_action` → "Stale action". */
export const words = (value: string) => { const text = value.replaceAll("_", " "); return text.charAt(0).toUpperCase() + text.slice(1); };
