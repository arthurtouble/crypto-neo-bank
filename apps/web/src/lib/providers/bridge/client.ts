import { z } from "zod";

export class BridgeError extends Error {
  readonly status: number;
  constructor(status: number, message: string) { super(message); this.name = "BridgeError"; this.status = status; }
}

/** Bridge API access. Every POST carries an idempotency key so a retried command never runs twice. */
export class BridgeClient {
  private readonly baseUrl: string;
  constructor(private readonly apiKey: string, baseUrl = "https://api.bridge.xyz/v0", private readonly fetcher: typeof fetch = fetch) {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  async request<T>(path: string, schema: z.ZodType<T>, init: { method?: "GET" | "POST" | "DELETE"; body?: unknown; idempotencyKey?: string } = {}): Promise<T> {
    const method = init.method ?? "GET";
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      method, signal: AbortSignal.timeout(12_000),
      headers: { "Api-Key": this.apiKey, "Content-Type": "application/json",
        ...(method === "POST" ? { "Idempotency-Key": init.idempotencyKey ?? crypto.randomUUID() } : {}) },
      body: init.body === undefined ? undefined : JSON.stringify(init.body)
    });
    if (!response.ok) throw new BridgeError(response.status, `Bridge request failed (${response.status}).`);
    const parsed = schema.safeParse(await response.json());
    // A response Aura does not recognise is never guessed at.
    if (!parsed.success) throw new BridgeError(502, "Bridge returned a response Aura does not recognise.");
    return parsed.data;
  }
}
