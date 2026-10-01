#!/usr/bin/env node

const target = process.env.AURA_SMOKE_URL;
if (!target) throw new Error("Set AURA_SMOKE_URL to the exact deployment origin to test.");
const url = new URL(target);
if (!/^https?:$/.test(url.protocol) || url.pathname !== "/" || url.search || url.hash)
  throw new Error("AURA_SMOKE_URL must be a deployment origin without a path or query.");
const baseUrl = url.origin;
const docsUrl = process.env.AURA_SMOKE_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const docsOrigin = new URL(docsUrl);
if (docsOrigin.protocol !== "https:" || docsOrigin.origin !== docsUrl)
  throw new Error("AURA_SMOKE_DOCS_URL must be an HTTPS origin without a path or query.");
let failures = 0;

function assert(condition, message) {
  if (!condition) {
    failures += 1;
    console.error(`FAIL  ${message}`);
  } else console.log(`PASS  ${message}`);
}

async function request(path, init) {
  return fetch(`${baseUrl}${path}`, { redirect: "manual", signal: AbortSignal.timeout(15_000), ...init });
}

const home = await request("/");
const homeHtml = await home.text();
assert(home.ok, `home responds (${home.status})`);
assert(homeHtml.includes("Money you control, in one simple app"), "home serves the Aura landing page");
assert(home.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is nosniff");
assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "CSP denies framing");
const structured = homeHtml.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
let structuredTypes = [];
try { structuredTypes = JSON.parse(structured ?? "")["@graph"].map((node) => node["@type"]); } catch { /* reported below */ }
assert(["Organization", "WebSite", "WebApplication", "FAQPage"].every((type) => structuredTypes.includes(type)), "home carries structured data that parses");

const robots = await request("/robots.txt");
const robotsText = await robots.text();
assert(robots.ok && robotsText.includes("Disallow: /"), "robots.txt is served and keeps crawlers out of private paths");
// Anything but production disallows the whole site, and then every response also carries X-Robots-Tag (worker/index.ts).
const noindex = /^Disallow: \/$/m.test(robotsText);
assert(noindex ? home.headers.get("x-robots-tag") === "noindex, nofollow" : !home.headers.get("x-robots-tag"),
  `X-Robots-Tag matches robots.txt (${noindex ? "not indexed" : "indexed"})`);

const llms = await request("/llms.txt");
assert(llms.ok && (await llms.text()).startsWith("# Aura\n"), `llms.txt is served (${llms.status})`);
const manifest = await request("/manifest.webmanifest");
const manifestBody = await manifest.json().catch(() => ({}));
assert(manifest.ok && manifestBody.start_url === "/app" && manifestBody.icons?.some((icon) => icon.purpose === "maskable"), `the web app manifest is served (${manifest.status})`);

const docsLlms = await fetch(`${docsUrl}/llms.txt`, { signal: AbortSignal.timeout(15_000) });
assert(docsLlms.ok && (await docsLlms.text()).startsWith("# Aura documentation"), `the docs serve llms.txt (${docsLlms.status})`);
const docsRobots = await (await fetch(`${docsUrl}/robots.txt`, { signal: AbortSignal.timeout(15_000) })).text();
const docsHome = await fetch(`${docsUrl}/`, { signal: AbortSignal.timeout(15_000) });
const docsNoindex = /^Disallow: \/$/m.test(docsRobots);
assert(docsNoindex ? docsHome.headers.get("x-robots-tag") === "noindex, nofollow" : !docsHome.headers.get("x-robots-tag"),
  `the docs' X-Robots-Tag matches their robots.txt (${docsNoindex ? "not indexed" : "indexed"})`);

const docs = await request("/docs");
assert([301, 308].includes(docs.status), `documentation redirects permanently to dedicated site (${docs.status})`);
// A redirect to an origin may come back with the root path's slash.
assert([docsUrl, `${docsUrl}/`].includes(docs.headers.get("location") ?? ""), "documentation redirects to the selected docs origin");

const health = await request("/api/health");
const healthBody = await health.json().catch(() => ({}));
assert(health.ok && healthBody.status === "ok" && healthBody.service === "aura-web", `Aura health reports ok (${health.status})`);
assert(healthBody.dependencies?.operationalDatabase === "ok", "health confirms the projection database binding");

// The server sends the app shell; the browser then shows a guest the labeled example data without loading Privy, or
// loads Privy for a saved session (docs/architecture/frontend-data.md). The end-to-end tests check the guest label.
for (const path of ["/app", "/app/deposit", "/app/earn", "/app/support"]) {
  const response = await request(path);
  const html = await response.text();
  assert(response.ok && html.includes("Getting your wallet ready") && /<meta name="robots" content="noindex/.test(html), `${path} serves the app shell, not indexed (${response.status})`);
}
const unknownTag = await request(`/pay/${crypto.randomUUID().replaceAll("-", "")}`);
assert(unknownTag.ok && (await unknownTag.text()).includes("Payment page unavailable"), "unknown Aura tag reveals no recipient");

for (const path of ["/api/activity", "/api/overview", "/api/ops/summary", "/api/ops/features", "/api/ops/stats"]) {
  const response = await request(path);
  assert([401, 403].includes(response.status), `${path} rejects an unauthenticated request (${response.status})`);
}

// Operator APIs take only a Cloudflare Access token that verifies; a made-up one is refused.
for (const path of ["/api/ops/me", "/api/ops/accounts?q=someone@example.com"]) {
  const response = await request(path, { headers: { "Cf-Access-Jwt-Assertion": "eyJhbGciOiJSUzI1NiIsImtpZCI6Im5vcGUifQ.eyJlbWFpbCI6Im1lQGV4YW1wbGUuY29tIn0.c2ln" } });
  assert([401, 403].includes(response.status), `${path} rejects a forged operator token (${response.status})`);
}

for (const path of ["/api/swap/assets?q=USD", "/api/routes/quote?from=8453:native&to=8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913&amount=1", "/api/actions/00000000-0000-4000-8000-000000000000"]) {
  const response = await request(path);
  assert([401, 403].includes(response.status), `${path} rejects unauthenticated account reads (${response.status})`);
  assert(response.headers.get("cache-control")?.includes("no-store"), `${path} does not cache account responses`);
}
for (const path of ["/api/actions", "/api/actions/00000000-0000-4000-8000-000000000000/submit"]) {
  const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert([401, 403].includes(response.status), `${path} rejects unauthenticated actions (${response.status})`);
  assert(response.headers.get("cache-control")?.includes("no-store"), `${path} does not cache action responses`);
}

for (const path of ["/api/growth/waitlist", "/api/portfolio", "/api/demo/session", "/api/markets/orders", "/api/support/assistant", "/api/support/cases", "/api/feedback", "/api/intents/prepare", "/api/swap/prepare", "/api/defi/aave/action"]) {
  const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(response.status === 404, `${path} is retired (${response.status})`);
}

for (const provider of ["bridge", "privy", "stripe", "resend"]) {
  const webhook = await request(`/api/webhooks/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_id: "smoke-test", type: "customer.updated" })
  });
  assert([401, 503].includes(webhook.status), `${provider} webhook rejects an unsigned event (${webhook.status})`);
}

console.log(`Smoke target: ${baseUrl}`);
if (failures) process.exitCode = 1;
