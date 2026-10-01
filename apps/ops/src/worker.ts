type Service = { fetch(request: Request): Promise<Response> };
export type Env = { WEB: Service; ASSETS: Service };

/** Only what the operator APIs need crosses to the web app: the Access token and the body's type. Cookies stay behind. */
const FORWARDED = ["cf-access-jwt-assertion", "content-type", "accept"];

/**
 * Set on every response this Worker returns: the page, its files, operator API answers, and refusals. The page is one
 * module script and one stylesheet from its own origin, plus the Geist fonts, so nothing outside 'self' is allowed
 * (images may also be data: URLs). Nothing may frame it.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'self'; object-src 'none'; form-action 'self'; frame-ancestors 'none'",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Resource-Policy": "same-origin"
};

function withSecurityHeaders(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(name, value);
  return out;
}

const refuse = (error: string, status: number) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

/**
 * A write must come from this app's own page. The browser's Sec-Fetch-Site decides when it sends one; older browsers
 * send Origin on writes instead. Anything else, including no signal at all, is refused: Access cookies ride along on
 * cross-site requests, so the Access token alone doesn't prove the operator meant it.
 */
function sameOrigin(request: Request, url: URL): boolean {
  const site = request.headers.get("sec-fetch-site");
  if (site) return site === "same-origin";
  const origin = request.headers.get("origin");
  return origin !== null && origin === url.origin;
}

/**
 * The operations app's Worker. Cloudflare Access has already let the request
 * in and added its signed token; `/api/<path>` goes to the web app's
 * `/api/ops/<path>`, which checks that token again. Everything else is the page.
 */
async function route(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
  const path = url.pathname.slice("/api/".length);
  if (!path || path.split("/").some((part) => part === "" || part === "." || part === "..")) return Response.json({ error: "not_found" }, { status: 404 });
  const read = request.method === "GET" || request.method === "HEAD";
  if (!read) {
    if (!sameOrigin(request, url)) return refuse("cross_site_request", 403);
    // Bodies are JSON only, so a plain HTML form can't submit one.
    const hasBody = request.body !== null && request.headers.get("content-length") !== "0";
    if (hasBody && !/^application\/json\s*(;|$)/i.test(request.headers.get("content-type") ?? "")) return refuse("unsupported_media_type", 415);
  }
  const headers = new Headers();
  for (const name of FORWARDED) { const value = request.headers.get(name); if (value) headers.set(name, value); }
  const body = read ? undefined : await request.arrayBuffer();
  const response = await env.WEB.fetch(new Request(`https://web.internal/api/ops/${path}${url.search}`, { method: request.method, headers, body }));
  const out = new Response(response.body, response);
  out.headers.set("Cache-Control", "no-store");
  return out;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withSecurityHeaders(await route(request, env));
  }
};
