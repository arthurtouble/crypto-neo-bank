import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseJsonc, productionBlockers } from "./production-check.mjs";

const devVars = { PRODUCT_ENVIRONMENT: "development", NEXT_PUBLIC_PRIVY_APP_ID: "dev-app", EMAIL_FROM: "Aura <onboarding@resend.dev>", VAPID_PUBLIC_KEY: "dev-key" };
const ready = () => ({
  web: { name: "aurel-financial-os",
    vars: { PRODUCT_ENVIRONMENT: "production", NEXT_PUBLIC_PRIVY_APP_ID: "prod-app", CF_ACCESS_TEAM_DOMAIN: "https://team.cloudflareaccess.com", CF_ACCESS_AUD: "aud",
      EMAIL_FROM: "Aura <hello@aura.example>", VAPID_PUBLIC_KEY: "prod-key" },
    d1_databases: [{ database_id: "prod-db" }], queues: { producers: [{ queue: "aurel-provider-events" }] },
    env: { dev: { vars: devVars, d1_databases: [{ database_id: "dev-db" }] } } },
  events: { d1_databases: [{ database_id: "prod-db" }], queues: { consumers: [{ queue: "aurel-provider-events" }] } },
  ops: { services: [{ binding: "WEB", service: "aurel-financial-os" }] }
});

test("a complete production configuration has no blockers", () => {
  assert.deepEqual(productionBlockers(ready()), []);
});

test("it catches dev values, missing variables, and mismatched Workers", () => {
  const configs = ready();
  Object.assign(configs.web.vars, { NEXT_PUBLIC_PRIVY_APP_ID: "dev-app", CF_ACCESS_AUD: "", EMAIL_FROM: devVars.EMAIL_FROM, VAPID_PUBLIC_KEY: "dev-key" });
  configs.web.env.dev.vars.INTERCOM_APP_ID = "abc";
  configs.events.d1_databases[0].database_id = "other";
  configs.ops.services[0].service = "aura-dev";
  const messages = productionBlockers(configs).map((blocker) => blocker.message).join("\n");
  for (const expected of ["no INTERCOM_APP_ID", "development Privy app", "every operator is refused", "test sender", "development VAPID key", "D1 database differs", "WEB binding"]) {
    assert.match(messages, new RegExp(expected));
  }
});

test("it reads the repository's wrangler files", () => {
  const web = parseJsonc(readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8"));
  assert.equal(web.name, "aurel-financial-os");
  assert.equal(parseJsonc('{ "a": "http://x", // note\n "b": [1, 2,], /* c */ }').a, "http://x");
});
