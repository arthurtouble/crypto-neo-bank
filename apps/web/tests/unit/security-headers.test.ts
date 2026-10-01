import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { securityHeaders, withSecurityHeaders } from "@/lib/http/security-headers";

const next = vi.fn<(request: Request) => Promise<Response>>();
vi.mock("vinext/server/app-router-entry", () => ({ default: { fetch: (request: Request) => next(request) } }));
vi.mock("@/lib/actions/recheck", () => ({ recheckOpenActions: vi.fn() }));
vi.mock("@/lib/money/bank-activity", () => ({ refreshBankPayouts: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPending: vi.fn() }));
vi.mock("@/lib/notifications/incoming", () => ({ scanIncoming: vi.fn() }));

const worker = async () => (await import("../../worker/index")).default as unknown as { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };
const expectAll = (response: Response) => {
  for (const { key, value } of securityHeaders) expect(response.headers.get(key), key).toBe(value);
  expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
};

afterEach(() => { vi.restoreAllMocks(); next.mockReset(); });

describe("security headers", () => {
  it("are on every response the Worker returns, even one vinext sent without them", async () => {
    next.mockImplementation(async () => new Response("<h1>page</h1>"));
    expectAll(await (await worker()).fetch(new Request("https://aura.test/"), {}, {}));
    expectAll(await (await worker()).fetch(new Request("https://aura.test/api/health"), {}, {}));
    expectAll(await (await worker()).fetch(new Request("https://aura.test/nowhere"), {}, {}));
  });

  it("are on the 451 page and the 451 API answer", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    next.mockImplementation(async () => new Response("unavailable"));
    const blocked = await (await worker()).fetch(new Request("https://aura.test/app", { headers: { "CF-IPCountry": "KP" } }), {}, {});
    expect(blocked.status).toBe(451);
    expectAll(blocked);
    const api = await (await worker()).fetch(new Request("https://aura.test/api/me", { headers: { "CF-IPCountry": "KP" } }), {}, {});
    expect(api.status).toBe(451);
    expectAll(api);
  });

  it("keeps a header the page already set, and leaves complete responses alone", () => {
    const own = new Response("", { headers: { "Content-Security-Policy": "default-src 'none'" } });
    const out = withSecurityHeaders(own);
    expect(out.headers.get("Content-Security-Policy")).toBe("default-src 'none'");
    expect(out.headers.get("X-Frame-Options")).toBe("DENY");
    const complete = withSecurityHeaders(new Response(""));
    expect(withSecurityHeaders(complete)).toBe(complete);
  });

  it("are the same on static files, which Cloudflare serves without running the Worker (public/_headers)", () => {
    const file = readFileSync(new URL("../../public/_headers", import.meta.url), "utf8");
    const block = file.split("\n").reduce<{ inside: boolean; rules: Record<string, string> }>((state, line) => {
      if (/^\S/.test(line) && !line.startsWith("#")) return { ...state, inside: line.trim() === "/*" };
      const match = state.inside ? line.match(/^\s+([A-Za-z-]+):\s*(.*)$/) : null;
      if (match) state.rules[match[1]] = match[2];
      return state;
    }, { inside: false, rules: {} }).rules;
    expect(block).toEqual(Object.fromEntries(securityHeaders.map(({ key, value }) => [key, value])));
  });
});
