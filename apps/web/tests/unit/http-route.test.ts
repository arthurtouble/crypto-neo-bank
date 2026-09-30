import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { AuthenticationError, AuthorizationError, FeatureUnavailableError, HttpError, RateLimitError,
  WalletOwnershipError } from "@/lib/http/errors";
import { errorResponse, readJsonBody, route } from "@/lib/http/route";

const request = (body?: string) => new Request("https://aura.test/api/example", { method: body === undefined ? "GET" : "POST", body });
const failing = (error: unknown, options: Partial<Parameters<typeof route>[1]> = {}) =>
  route("example.test", { unavailable: "example_unavailable", ...options }, async () => { throw error; });

afterEach(() => vi.restoreAllMocks());

describe("API route wrapper", () => {
  it("passes a successful response through and defaults it to no-store", async () => {
    const handler = route("example.ok", { unavailable: "example_unavailable" }, async () => Response.json({ ok: true }));
    const response = await handler(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true });
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("keeps an explicit cache policy chosen by the handler", async () => {
    const handler = route("example.public", { unavailable: "example_unavailable" },
      async () => Response.json({}, { headers: { "Cache-Control": "public, max-age=15" } }));
    expect((await handler(request())).headers.get("Cache-Control")).toBe("public, max-age=15");
  });

  it("gives each request its own trace ID", async () => {
    const handler = route("example.trace", { unavailable: "example_unavailable" }, async (_request, { traceId }) => Response.json({ traceId }));
    const [a, b] = await Promise.all([handler(request()), handler(request())]).then((responses) => Promise.all(responses.map((item) => item.json() as Promise<{ traceId: string }>)));
    expect(a.traceId).toMatch(/^[0-9a-f-]{36}$/);
    expect(a.traceId).not.toBe(b.traceId);
  });

  it.each([
    [new AuthenticationError(), 401, "unauthorized"],
    [new AuthorizationError(), 403, "forbidden"],
    [new WalletOwnershipError(), 403, "wallet_not_linked"],
    [new FeatureUnavailableError("swaps"), 503, "feature_unavailable"],
    [new HttpError(409, "custom_conflict", "Custom conflict."), 409, "custom_conflict"]
  ] as const)("maps %s to its declared status and code", async (error, status, code) => {
    const response = await failing(error)(request());
    expect(response.status).toBe(status);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toMatchObject({ error: code, message: (error as Error).message });
    expect(body.traceId).toEqual(expect.any(String));
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("returns Retry-After for rate limits", async () => {
    const response = await failing(new RateLimitError(42))(request());
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("42");
    expect(await response.json()).toMatchObject({ error: "rate_limited" });
  });

  it("maps validation failures and malformed JSON to 400 with the route's code", async () => {
    const schema = z.object({ amount: z.string() });
    const handler = route("example.input", { invalid: "invalid_example", unavailable: "example_unavailable" },
      async (incoming) => Response.json(schema.parse(await readJsonBody(incoming))));
    const zod = await handler(request(JSON.stringify({ amount: 1 })));
    expect(zod.status).toBe(400);
    expect(await zod.json()).toMatchObject({ error: "invalid_example", issues: [expect.objectContaining({ path: ["amount"] })] });
    const malformed = await handler(request("{not json"));
    expect(malformed.status).toBe(400);
    expect(await malformed.json()).toMatchObject({ error: "invalid_example" });
  });

  it("treats JSON that fails to parse anywhere else, such as a provider's answer, as an unexpected failure", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const handler = route("example.provider", { invalid: "invalid_example", unavailable: "example_unavailable" },
      async () => Response.json(JSON.parse("<html>Bad gateway</html>")));
    const response = await handler(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: "example_unavailable" });
  });

  it("logs unexpected failures with the trace ID and never leaks their message", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await failing(new Error("database password in stack"))(request());
    expect(response.status).toBe(503);
    const body = await response.json() as Record<string, unknown>;
    expect(body).toEqual({ error: "example_unavailable", traceId: expect.any(String) });
    expect(JSON.stringify(body)).not.toContain("password");
    const logged = JSON.parse(String(log.mock.calls[0][0])) as Record<string, unknown>;
    expect(logged).toMatchObject({ level: "error", event: "example.test.failed", traceId: body.traceId });
  });

  it("uses a route's customer fallback status and message for unexpected failures", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const response = await failing(new Error("upstream"), { unavailableStatus: 422, unavailableMessage: "Try again later." })(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "example_unavailable", message: "Try again later." });
  });

  it("lets a route map its own errors before the shared mapping", async () => {
    class QuoteError extends Error {}
    const response = await failing(new QuoteError("no route"), {
      onError: (error, context) => error instanceof QuoteError ? errorResponse(422, "no_route", context) : undefined
    })(request());
    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: "no_route" });
    // Errors the hook does not claim still get the shared mapping.
    const shared = await failing(new AuthenticationError(), { onError: () => undefined })(request());
    expect(shared.status).toBe(401);
  });

  it("passes route params through to the handler", async () => {
    const handler = route("example.params", { unavailable: "example_unavailable" },
      async (_request, _context, params: { params: Promise<{ id: string }> }) => Response.json({ id: (await params.params).id }));
    expect(await (await handler(request(), { params: Promise.resolve({ id: "abc" }) })).json()).toEqual({ id: "abc" });
  });
});
