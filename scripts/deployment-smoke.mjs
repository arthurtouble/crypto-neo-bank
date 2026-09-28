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

for (const path of ["/app", "/app/deposit", "/app/earn", "/app/support"]) {
  const response = await request(path);
  assert(response.ok && (await response.text()).includes("Example data"), `${path} offers labeled guest browsing (${response.status})`);
}
const unknownTag = await request(`/pay/${crypto.randomUUID().replaceAll("-", "")}`);
assert(unknownTag.ok && (await unknownTag.text()).includes("Payment page unavailable"), "unknown Aura tag reveals no recipient");

for (const path of ["/api/activity", "/api/overview", "/api/ops/summary", "/api/ops/features", "/api/ops/analytics"]) {
  const response = await request(path);
  assert([401, 403].includes(response.status), `${path} rejects an unauthenticated request (${response.status})`);
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

for (const provider of ["bridge", "privy", "stripe"]) {
  const webhook = await request(`/api/webhooks/${provider}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ event_id: "smoke-test", type: "customer.updated" })
  });
  assert([401, 503].includes(webhook.status), `${provider} webhook rejects an unsigned event (${webhook.status})`);
}

console.log(`Smoke target: ${baseUrl}`);
if (failures) process.exitCode = 1;
