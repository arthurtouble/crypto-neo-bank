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
assert(docs.ok, `documentation responds (${docs.status})`);
assert((await docs.text()).includes("Security"), "documentation contains the security section");

const health = await request("/api/health");
const healthBody = await health.json().catch(() => ({}));
assert(health.ok && healthBody.status === "ok", `health reports ok (${health.status})`);
assert(healthBody.dependencies?.operationalDatabase === "ok", "health confirms the projection database binding");

for (const path of ["/api/portfolio", "/api/activity", "/api/ops/summary"]) {
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
