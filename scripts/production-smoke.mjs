#!/usr/bin/env node

const baseUrl = (process.env.AUREL_BASE_URL ?? "https://aurel-financial-os.aurel-events.workers.dev").replace(/\/$/, "");
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
assert(home.headers.get("x-content-type-options") === "nosniff", "X-Content-Type-Options is nosniff");
assert(home.headers.get("content-security-policy")?.includes("frame-ancestors 'none'"), "CSP denies framing");

const docs = await request("/docs");
assert([301, 302, 307, 308].includes(docs.status), `documentation redirects to dedicated site (${docs.status})`);
assert(docs.headers.get("location") === "https://aurel-docs.aurel-events.workers.dev", "documentation redirect uses the canonical docs origin");

const health = await request("/api/health");
const healthBody = await health.json().catch(() => ({}));
assert(health.ok && healthBody.status === "ok", `health reports ok (${health.status})`);
assert(healthBody.dependencies?.operationalDatabase === "ok", "health confirms the projection database binding");

const status = await request("/api/status");
const statusBody = await status.json().catch(() => ({}));
assert([200, 503].includes(status.status) && Array.isArray(statusBody.components), `public status returns bounded component state (${status.status})`);

for (const path of ["/api/portfolio", "/api/activity", "/api/ops/summary", "/api/ops/beta", "/api/ops/features", "/api/ops/analytics", "/api/beta/access"]) {
  const response = await request(path);
  const accepted = path === "/api/portfolio" ? [401, 403, 410] : [401, 403];
  assert(accepted.includes(response.status), `${path} rejects or retires an unauthenticated request (${response.status})`);
}

const webhook = await request("/api/webhooks/provider", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ id: "smoke-test", type: "account.updated" })
});
assert([400, 401, 403].includes(webhook.status), `webhook rejects an unsigned event (${webhook.status})`);

console.log(`Smoke target: ${baseUrl}`);
if (failures) process.exitCode = 1;
