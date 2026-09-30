import { beforeEach, describe, expect, it, vi } from "vitest";
import { blockedPlace, isGatedPath, requestPlace } from "@/lib/legal/places";

const served: string[] = [];
vi.mock("vinext/server/app-router-entry", () => ({
  default: { fetch: async (request: Request) => { served.push(new URL(request.url).pathname);
    return new Response("<h1>page</h1>", { headers: { "Content-Type": "text/html", "Content-Security-Policy": "default-src 'self'" } }); } }
}));
vi.mock("@/lib/actions/recheck", () => ({ recheckOpenActions: vi.fn() }));
vi.mock("@/lib/money/bank-activity", () => ({ refreshBankPayouts: vi.fn() }));
vi.mock("@/lib/notifications/deliver", () => ({ deliverPending: vi.fn() }));
vi.mock("@/lib/notifications/incoming", () => ({ scanIncoming: vi.fn() }));

const from = (path: string, country?: string, regionCode?: string) => {
  const request = new Request(`https://aura.test${path}`, { headers: country ? { "CF-IPCountry": country } : {} });
  if (regionCode) Object.defineProperty(request, "cf", { value: { country, regionCode } });
  return request;
};
const worker = async () => (await import("../../worker/index")).default as unknown as { fetch: (request: Request, env: unknown, ctx: unknown) => Promise<Response> };

beforeEach(() => { served.length = 0; vi.spyOn(console, "log").mockImplementation(() => {}); });

describe("sanctioned places", () => {
  it("blocks the listed countries and regions, and nothing else", () => {
    for (const code of ["CU", "IR", "KP", "SY", "ir"]) expect(blockedPlace(code, undefined)).toBeTruthy();
    for (const region of ["43", "40", "14", "09"]) expect(blockedPlace("UA", region)).toBeTruthy();
    expect(blockedPlace("UA", "30")).toBeUndefined();
    expect(blockedPlace("UA", undefined)).toBeUndefined();
    expect(blockedPlace("US", "43")).toBeUndefined();
    expect(blockedPlace("GB", undefined)).toBeUndefined();
    expect(blockedPlace(undefined, undefined)).toBeUndefined();
    expect(blockedPlace("XX", undefined)).toBeUndefined();
  });

  it("gates the app, the API, and payment pages, in every form the router serves them", () => {
    for (const path of ["/app", "/app/send", "/app.rsc", "/app/send.rsc", "/APP", "/%61pp", "//app", "/api/overview", "/pay/sam"]) expect(isGatedPath(path), path).toBe(true);
    for (const path of ["/", "/unavailable", "/apply", "/api/health", "/api/webhooks/bridge", "/images/aura-overview.png", "/payments"]) expect(isGatedPath(path), path).toBe(false);
  });

  it("reads the country from Cloudflare's header, and the region from the cf object", () => {
    expect(requestPlace(from("/app", "IR"))).toEqual({ country: "IR", region: undefined });
    expect(requestPlace(from("/app", "UA", "43"))).toEqual({ country: "UA", region: "43" });
    expect(requestPlace(from("/app"))).toEqual({ country: undefined, region: undefined });
  });
});

describe("the web Worker's place check", () => {
  it("serves the unavailable page with 451 in place of the app, keeping the page's security headers", async () => {
    const response = await (await worker()).fetch(from("/app/send", "KP"), {}, {});
    expect(response.status).toBe(451);
    expect(served).toEqual(["/unavailable"]);
    expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
  });

  it("refuses the API with a JSON error, before any handler runs", async () => {
    const response = await (await worker()).fetch(from("/api/overview", "UA", "14"), {}, {});
    expect(response.status).toBe(451);
    expect(await response.json()).toMatchObject({ error: "place_unavailable" });
    expect(served).toEqual([]);
  });

  it("lets everyone else through, and keeps public pages open everywhere", async () => {
    const app = await worker();
    for (const [path, country] of [["/app", "US"], ["/api/overview", "UA"], ["/", "IR"], ["/api/health", "SY"], ["/app", undefined]] as const) {
      expect((await app.fetch(from(path, country), {}, {})).status, `${path} ${country}`).toBe(200);
    }
    expect(served).toEqual(["/app", "/api/overview", "/", "/api/health", "/app"]);
  });
});
