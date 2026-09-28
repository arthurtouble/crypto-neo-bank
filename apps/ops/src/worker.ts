type Service = { fetch(request: Request): Promise<Response> };
export type Env = { WEB: Service; ASSETS: Service };

/** Only what the operator APIs need crosses to the web app: the Access token and the body's type. Cookies stay behind. */
const FORWARDED = ["cf-access-jwt-assertion", "content-type", "accept"];

/**
 * The operations app's Worker. Cloudflare Access has already let the request
 * in and added its signed token; `/api/<path>` goes to the web app's
 * `/api/ops/<path>`, which checks that token again. Everything else is the page.
 */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    const path = url.pathname.slice("/api/".length);
    if (!path || path.split("/").some((part) => part === "" || part === "." || part === "..")) return Response.json({ error: "not_found" }, { status: 404 });
    const headers = new Headers();
    for (const name of FORWARDED) { const value = request.headers.get(name); if (value) headers.set(name, value); }
    const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
    const response = await env.WEB.fetch(new Request(`https://web.internal/api/ops/${path}${url.search}`, { method: request.method, headers, body }));
    const out = new Response(response.body, response);
    out.headers.set("Cache-Control", "no-store");
    return out;
  }
};
