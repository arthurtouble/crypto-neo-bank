import { afterEach, describe, expect, it, vi } from "vitest";

const next = vi.fn<(request: Request) => Promise<Response>>();
vi.mock("vinext/server/app-router-entry", () => ({ default: { fetch: (request: Request) => next(request) } }));
vi.mock("@/lib/actions/recheck", () => ({ recheckOpenActions: vi.fn() }));
vi.mock("@/lib/money/bank-activity", () => ({ refreshBankPayouts: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPending: vi.fn() }));
vi.mock("@/lib/notifications/incoming", () => ({ scanIncoming: vi.fn() }));

const worker = async () => (await import("../../worker/index")).default as unknown as { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
const logged = (spy: { mock: { calls: unknown[][] } }) => spy.mock.calls.map(([line]) => JSON.parse(String(line)));

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); next.mockReset(); });

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
