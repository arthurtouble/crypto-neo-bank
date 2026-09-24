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
assert(home.ok, `home responds (${home.status})`);
assert((await home.text()).includes("Your Smart Account"), "home serves the Aura landing page");
assert(home.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is nosniff");
assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "CSP denies framing");

const docs = await request("/docs");
assert([301, 302, 307, 308].includes(docs.status), `documentation redirects to dedicated site (${docs.status})`);
assert(docs.headers.get("location") === docsUrl, "documentation redirects to the selected docs origin");

const health = await request("/api/health");
const healthBody = await health.json().catch(() => ({}));
assert(health.ok && healthBody.status === "ok" && healthBody.service === "aura-web", `Aura health reports ok (${health.status})`);
assert(healthBody.dependencies?.operationalDatabase === "ok", "health confirms the projection database binding");

for (const path of ["/app", "/app/deposit", "/app/borrow", "/app/support"]) {
  const response = await request(path);
  assert(response.ok && (await response.text()).includes("Example data"), `${path} offers labeled guest browsing (${response.status})`);
}
const unknownTag = await request(`/pay/${crypto.randomUUID().replaceAll("-", "")}`);
assert(unknownTag.ok && (await unknownTag.text()).includes("Payment page unavailable"), "unknown Aura tag reveals no recipient");

const status = await request("/api/status");
const statusBody = await status.json().catch(() => ({}));
assert([200, 503].includes(status.status) && Array.isArray(statusBody.components), `public status returns bounded component state (${status.status})`);

for (const path of ["/api/portfolio", "/api/activity", "/api/defi/aave/positions?address=0x000000000000000000000000000000000000dEaD", "/api/ops/summary", "/api/ops/beta", "/api/ops/features", "/api/ops/analytics", "/api/beta/access"]) {
  const response = await request(path);
  const accepted = path === "/api/portfolio" ? [401, 403, 410] : [401, 403];
  assert(accepted.includes(response.status), `${path} rejects or retires an unauthenticated request (${response.status})`);
}

for (const path of ["/api/portfolio/history?range=7D", "/api/portfolio/tax-support?year=2026", "/api/swap/assets?q=USD"]) {
  const response = await request(path);
  assert([401, 403].includes(response.status), `${path} rejects unauthenticated account reads (${response.status})`);
  assert(response.headers.get("cache-control")?.includes("no-store"), `${path} does not cache account responses`);
}
for (const path of ["/api/portfolio/refresh", "/api/swap/quote", "/api/intents/prepare", "/api/defi/aave/preview"]) {
  const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert([401, 403].includes(response.status), `${path} rejects unauthenticated actions (${response.status})`);
  assert(response.headers.get("cache-control")?.includes("no-store"), `${path} does not cache action responses`);
}

for (const path of ["/api/growth/waitlist", "/api/growth/events"]) {
  const response = await request(path, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert(response.status === 410, `${path} rejects retired public writes (${response.status})`);
}

const webhook = await request("/api/webhooks/provider", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: "smoke-test", type: "account.updated" })
});
assert([400, 401, 403].includes(webhook.status), `webhook rejects an unsigned event (${webhook.status})`);

console.log(`Smoke target: ${baseUrl}`);
if (failures) process.exitCode = 1;
