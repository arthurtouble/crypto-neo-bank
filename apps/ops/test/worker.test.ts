import { describe, expect, it } from "vitest";
import worker, { type Env } from "../src/worker";

function env() {
  const seen: Request[] = [];
  const service = (name: string) => ({ fetch: async (request: Request) => { seen.push(request); return new Response(name, { headers: { "Cache-Control": "public" } }); } });
  return { seen, env: { WEB: service("web"), ASSETS: service("page") } satisfies Env };
}

describe("the operations Worker", () => {
  it("forwards /api/* to the web app's operator APIs with only the Access token and body", async () => {
    const { seen, env: bindings } = env();
    const response = await worker.fetch(new Request("https://ops.aura.test/api/accounts?q=alice", {
      headers: { "Cf-Access-Jwt-Assertion": "token", Cookie: "CF_Authorization=secret", Authorization: "Bearer privy" } }), bindings);
    expect(await response.text()).toBe("web");
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(seen[0].url).toBe("https://web.internal/api/ops/accounts?q=alice");
    expect(seen[0].headers.get("cf-access-jwt-assertion")).toBe("token");
    expect(seen[0].headers.get("cookie")).toBeNull();
    expect(seen[0].headers.get("authorization")).toBeNull();

    await worker.fetch(new Request("https://ops.aura.test/api/features", { method: "PATCH", headers: { "Content-Type": "application/json", "Sec-Fetch-Site": "same-origin" }, body: '{"key":"swaps"}' }), bindings);
    expect(seen[1].method).toBe("PATCH");
    expect(await seen[1].text()).toBe('{"key":"swaps"}');
  });

  it("serves the page for everything else, and never forwards a path outside /api/ops", async () => {
    const { seen, env: bindings } = env();
    expect(await (await worker.fetch(new Request("https://ops.aura.test/customers"), bindings)).text()).toBe("page");
    expect((await worker.fetch(new Request("https://ops.aura.test/api/"), bindings)).status).toBe(404);
    // The URL parser resolves dot segments first, so this is the page at /actions, never an API.
    expect(await (await worker.fetch(new Request("https://ops.aura.test/api/%2e%2e/actions"), bindings)).text()).toBe("page");
    expect(seen.map((request) => request.url)).toEqual(["https://ops.aura.test/customers", "https://ops.aura.test/actions"]);
  });

  it("sets security headers on the page, API answers, and refusals", async () => {
    const { env: bindings } = env();
    const responses = [
      await worker.fetch(new Request("https://ops.aura.test/customers"), bindings),
      await worker.fetch(new Request("https://ops.aura.test/api/accounts"), bindings),
      await worker.fetch(new Request("https://ops.aura.test/api/"), bindings),
      await worker.fetch(new Request("https://ops.aura.test/api/features", { method: "POST", headers: { "Sec-Fetch-Site": "cross-site" } }), bindings)
    ];
    for (const response of responses) {
      expect(response.headers.get("X-Frame-Options")).toBe("DENY");
      expect(response.headers.get("Content-Security-Policy")).toContain("frame-ancestors 'none'");
      expect(response.headers.get("Content-Security-Policy")).toContain("default-src 'self'");
      expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response.headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
      expect(response.headers.get("Strict-Transport-Security")).toContain("max-age=");
    }
  });

  describe("writes", () => {
    const write = (headers: Record<string, string>, body: string | null = "{}") =>
      new Request("https://ops.aura.test/api/features", { method: "POST", headers, body });
    const json = { "Content-Type": "application/json" };

    it("are refused unless the browser says they come from this origin", async () => {
      const { seen, env: bindings } = env();
      for (const headers of [
        { ...json, "Sec-Fetch-Site": "cross-site" }, { ...json, "Sec-Fetch-Site": "same-site" }, { ...json, "Sec-Fetch-Site": "none" },
        { ...json, Origin: "https://evil.example" }, { ...json }
      ]) {
        const response = await worker.fetch(write(headers), bindings);
        expect(response.status).toBe(403);
        expect(await response.json()).toEqual({ error: "cross_site_request" });
      }
      expect(seen).toHaveLength(0);
      expect((await worker.fetch(write({ ...json, "Sec-Fetch-Site": "same-origin" }), bindings)).status).toBe(200);
      expect((await worker.fetch(write({ ...json, Origin: "https://ops.aura.test" }), bindings)).status).toBe(200);
      // When the browser sends Sec-Fetch-Site, it decides, whatever Origin says.
      expect((await worker.fetch(write({ ...json, "Sec-Fetch-Site": "cross-site", Origin: "https://ops.aura.test" }), bindings)).status).toBe(403);
    });

    it("must carry JSON when they have a body", async () => {
      const { seen, env: bindings } = env();
      for (const type of ["text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x"]) {
        expect((await worker.fetch(write({ "Content-Type": type, "Sec-Fetch-Site": "same-origin" }, "a=b"), bindings)).status).toBe(415);
      }
      expect((await worker.fetch(write({ "Sec-Fetch-Site": "same-origin" }, "a=b"), bindings)).status).toBe(415);
      expect(seen).toHaveLength(0);
      expect((await worker.fetch(write({ "Content-Type": "application/json; charset=utf-8", "Sec-Fetch-Site": "same-origin" }, "{}"), bindings)).status).toBe(200);
      expect((await worker.fetch(write({ "Sec-Fetch-Site": "same-origin" }, null), bindings)).status).toBe(200);
    });

    it("leave reads alone", async () => {
      const { env: bindings } = env();
      expect((await worker.fetch(new Request("https://ops.aura.test/api/features", { headers: { "Sec-Fetch-Site": "cross-site" } }), bindings)).status).toBe(200);
    });
  });
});
