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

    await worker.fetch(new Request("https://ops.aura.test/api/features", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: '{"key":"swaps"}' }), bindings);
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
});
