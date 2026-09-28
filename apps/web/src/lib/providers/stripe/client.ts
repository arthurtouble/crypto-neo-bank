import { z } from "zod";
import { localEdgeUrl } from "@/lib/testing/local-edge";

export class StripeError extends Error {
  readonly status: number;
  readonly code: string | null;
  constructor(status: number, message: string, code: string | null = null) { super(message); this.name = "StripeError"; this.status = status; this.code = code; }
}

/**
 * The API version Aura is written against. Stablecoin-backed cards
 * (`crypto_wallet`) came to Stripe Issuing with Bridge in 2026; confirm the
 * version with Bridge before going live.
 */
export const STRIPE_API_VERSION = "2026-03-25.preview";

type FormValue = string | number | boolean | null | undefined | FormValue[] | { [key: string]: FormValue };

/** Stripe's form encoding: nested keys in brackets, arrays by index. */
export function stripeForm(values: Record<string, FormValue>, prefix = "", into = new URLSearchParams()): URLSearchParams {
  for (const [key, value] of Object.entries(values)) {
    const name = prefix ? `${prefix}[${key}]` : key;
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) value.forEach((item, index) => typeof item === "object" && item !== null
      ? stripeForm(item as Record<string, FormValue>, `${name}[${index}]`, into) : into.append(`${name}[${index}]`, String(item)));
    else if (typeof value === "object") stripeForm(value, name, into);
    else into.append(name, String(value));
  }
  return into;
}

/** Stripe API access with the secret key, for Issuing. Every POST carries an idempotency key. */
export class StripeClient {
  private readonly baseUrl: string;
  constructor(private readonly secretKey: string, baseUrl = localEdgeUrl("STRIPE_API_URL") ?? "https://api.stripe.com", private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request<T>(path: string, schema: z.ZodType<T>, init: { method?: "GET" | "POST"; form?: Record<string, FormValue>; query?: Record<string, string>;
    idempotencyKey?: string; version?: string } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const query = init.query ? `?${new URLSearchParams(init.query)}` : "";
    const response = await this.fetcher(`${this.baseUrl}${path}${query}`, {
      method, signal: AbortSignal.timeout(12_000),
      headers: { Authorization: `Bearer ${this.secretKey}`, "Stripe-Version": init.version ?? STRIPE_API_VERSION,
        ...(method === "POST" ? { "Content-Type": "application/x-www-form-urlencoded", "Idempotency-Key": init.idempotencyKey ?? crypto.randomUUID() } : {}) },
      body: method === "POST" ? stripeForm(init.form ?? {}).toString() : undefined
    });
    const body = await response.json().catch(() => null) as { error?: { message?: string; code?: string } } | null;
    if (!response.ok) throw new StripeError(response.status, `Stripe request failed (${response.status}).`, body?.error?.code ?? null);
    const parsed = schema.safeParse(body);
    // A response Aura does not recognise is never guessed at.
    if (!parsed.success) throw new StripeError(502, "Stripe returned a response Aura does not recognise.");
    return parsed.data;
  }
}
