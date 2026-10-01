import { afterEach, describe, expect, it, vi } from "vitest";

const next = vi.fn<(request: Request) => Promise<Response>>();
vi.mock("vinext/server/app-router-entry", () => ({ default: { fetch: (request: Request) => next(request) } }));
vi.mock("@/lib/actions/recheck", () => ({ recheckOpenActions: vi.fn() }));
vi.mock("@/lib/money/bank-activity", () => ({ refreshBankPayouts: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPending: vi.fn() }));
vi.mock("@/lib/notifications/incoming", () => ({ scanIncoming: vi.fn() }));
vi.mock("@/lib/privacy/retention", () => ({ purgeDue: (now: Date) => now.getUTCMinutes() === 0, purgeExpired: vi.fn(async () => ({})) }));

const worker = async () => (await import("../../worker/index")).default as unknown as { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([line]) => JSON.parse(String(line)));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); next.mockReset(); });

describe("the web Worker's schedule", () => {
  it("delivers notices even when the scan for money received fails, and logs each job on its own", async () => {
    const { recheckOpenActions } = await import("@/lib/actions/recheck");
    const { refreshBankPayouts } = await import("@/lib/money/bank-activity");
    const { scanIncoming } = await import("@/lib/notifications/incoming");
    const { deliverPending } = await import("@/lib/notifications/deliver");
    vi.mocked(recheckOpenActions).mockResolvedValue({ checked: 0, advanced: 0, failedChecks: 0, expired: 0 });
    vi.mocked(refreshBankPayouts).mockResolvedValue(undefined as never);
    vi.mocked(scanIncoming).mockRejectedValue(new Error("alchemy down"));
    vi.mocked(deliverPending).mockResolvedValue(3);
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    const pending: Promise<unknown>[] = [];
    const { scheduled } = (await import("../../worker/index")).default as unknown as { scheduled: (controller: unknown, env: unknown, ctx: unknown) => Promise<void> };
    await scheduled({ scheduledTime: 0 }, { PROJECTION_DB: {} }, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
    await Promise.all(pending);
    expect(deliverPending).toHaveBeenCalled();
    expect(logged(info)).toContainEqual(expect.objectContaining({ event: "notifications.deliver.completed", summary: { delivered: 3 } }));
    expect(logged(error)).toContainEqual(expect.objectContaining({ event: "notifications.scan.failed", message: "alchemy down" }));
  });

  it("cleans up expired records once an hour, logging one summary", async () => {
    const { purgeExpired } = await import("@/lib/privacy/retention");
    vi.mocked(purgeExpired).mockResolvedValue({ product_events: 2 } as never);
    const info = vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { scheduled } = (await import("../../worker/index")).default as unknown as { scheduled: (controller: unknown, env: unknown, ctx: unknown) => Promise<void> };
    const run = async (scheduledTime: number) => {
      const pending: Promise<unknown>[] = [];
      await scheduled({ scheduledTime }, { PROJECTION_DB: {} }, { waitUntil: (promise: Promise<unknown>) => pending.push(promise) });
      await Promise.allSettled(pending);
    };
    await run(Date.parse("2026-10-01T12:02:00.000Z"));
    expect(purgeExpired).not.toHaveBeenCalled();
    await run(Date.parse("2026-10-01T13:00:00.000Z"));
    expect(purgeExpired).toHaveBeenCalledTimes(1);
    expect(logged(info)).toContainEqual(expect.objectContaining({ event: "retention.purge.completed", summary: { product_events: 2 } }));
  });
});

describe("web Worker error logging", () => {
  it("logs a page that fails with 5xx, without the query string", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    next.mockResolvedValue(new Response("", { status: 500 }));
    expect((await (await worker()).fetch(new Request("https://aura.test/app/send?sendTo=0xabc"), {}, {})).status).toBe(500);
    expect(logged(error)).toEqual([{ level: "error", event: "request.failed", method: "GET", path: "/app/send", status: 500 }]);
  });

  it("logs a thrown failure and rethrows it", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    next.mockRejectedValue(new Error("render broke"));
    await expect((await worker()).fetch(new Request("https://aura.test/app"), {}, {})).rejects.toThrow("render broke");
    expect(logged(error)).toEqual([{ level: "error", event: "request.failed", method: "GET", path: "/app", message: "render broke" }]);
  });

  it("leaves successful pages and API errors (logged by the route wrapper) alone", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    next.mockResolvedValueOnce(new Response("ok")).mockResolvedValueOnce(new Response("", { status: 503 }));
    const app = await worker();
    await app.fetch(new Request("https://aura.test/app"), {}, {});
    await app.fetch(new Request("https://aura.test/api/overview"), {}, {});
    expect(error).not.toHaveBeenCalled();
  });
});

describe("web Worker search-engine header", () => {
  it("asks search engines not to index any response outside production", async () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "development");
    next.mockResolvedValue(new Response("ok", { headers: { "content-type": "text/html" } }));
    const response = await (await worker()).fetch(new Request("https://aura.test/"), {}, {});
    expect(response.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(response.headers.get("content-type")).toBe("text/html");
    expect(await response.text()).toBe("ok");
  });

  it("leaves production responses indexable", async () => {
    vi.stubEnv("PRODUCT_ENVIRONMENT", "production");
    next.mockResolvedValue(new Response("ok"));
    expect((await (await worker()).fetch(new Request("https://aura.test/"), {}, {})).headers.get("x-robots-tag")).toBeNull();
  });
});
