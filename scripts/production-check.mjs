#!/usr/bin/env node
// Checks that the production Worker configuration is ready to deploy, without contacting Cloudflare or changing
// anything. It reads the wrangler.jsonc files and the build variables in this shell (the addresses the web app and the
// docs are built with), and lists what still has to be done, with the step in docs/operations/production-launch.md.
// It exits 1 while anything blocks a production deploy.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** Parse JSONC: drop comments outside strings and trailing commas. */
export function parseJsonc(text) {
  let out = "";
  for (let i = 0, inString = false; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      out += char;
      if (char === "\\") out += text[++i];
      else if (char === "\"") inString = false;
    } else if (char === "\"") { inString = true; out += char; }
    else if (char === "/" && text[i + 1] === "/") { while (i < text.length && text[i] !== "\n") i++; out += "\n"; }
    else if (char === "/" && text[i + 1] === "*") { i = text.indexOf("*/", i + 2) + 1; if (i === 0) break; }
    else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Variables that differ between environments on purpose: the check doesn't expect them to match dev. */
const perEnvironment = new Set(["PRODUCT_ENVIRONMENT"]);

/** Build-time variables: read when the web app and the docs are built, so they live in the deploying shell, not wrangler. */
export const buildVariables = ["NEXT_PUBLIC_DOCS_URL", "AURA_DOCS_SITE", "AURA_APP_URL"];
const origin = (value) => { try { return new URL(value).origin; } catch { return undefined; } };

/**
 * Every blocker in the production configuration. `configs` holds the parsed web, events, and ops wrangler files, and
 * `build` the build variables (process.env when run).
 */
export function productionBlockers({ web, events, ops, build = {} }) {
  const blockers = [];
  const prod = web.vars ?? {};
  const dev = web.env?.dev?.vars ?? {};
  const add = (message, step) => blockers.push({ message, step });

  for (const name of Object.keys(dev)) {
    if (!perEnvironment.has(name) && !(name in prod)) add(`web: production has no ${name} variable (dev has one).`, "Variables");
  }
  if (prod.PRODUCT_ENVIRONMENT !== "production") add("web: PRODUCT_ENVIRONMENT must be \"production\".", "Variables");
  if (prod.NEXT_PUBLIC_PRIVY_APP_ID && prod.NEXT_PUBLIC_PRIVY_APP_ID === dev.NEXT_PUBLIC_PRIVY_APP_ID) {
    add("web: production uses the development Privy app. Create a production Privy app and set its ID.", "Privy");
  }
  if (!prod.CF_ACCESS_TEAM_DOMAIN || !prod.CF_ACCESS_AUD) add("web: CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are empty, so every operator is refused.", "Operations app");
  if (typeof prod.EMAIL_FROM === "string" && prod.EMAIL_FROM.includes("resend.dev")) add("web: EMAIL_FROM uses Resend's test sender. Verify a domain.", "Variables");
  if (typeof prod.APP_ORIGIN === "string" && prod.APP_ORIGIN.includes("workers.dev")) add("web: APP_ORIGIN is a workers.dev address, not the custom domain.", "Domain");
  if (prod.VAPID_PUBLIC_KEY && prod.VAPID_PUBLIC_KEY === dev.VAPID_PUBLIC_KEY) add("web: production reuses the development VAPID key. Make a pair for production.", "Variables");

  // The docs' address (the app's docs links, and the docs' own canonical URLs and sitemap) and the app's address (the
  // docs' link back home) are set when each is built. Unset, both fall back to workers.dev addresses.
  for (const name of buildVariables) {
    const value = build[name];
    if (!value) add(`build: ${name} isn't set in this shell, so the build falls back to a workers.dev address.`, "Domain");
    else if (!origin(value)?.startsWith("https://") || value.includes("workers.dev")) add(`build: ${name} must be the custom domain's https origin, not ${value}.`, "Domain");
  }
  if (build.NEXT_PUBLIC_DOCS_URL && build.AURA_DOCS_SITE && origin(build.NEXT_PUBLIC_DOCS_URL) !== origin(build.AURA_DOCS_SITE)) {
    add("build: NEXT_PUBLIC_DOCS_URL and AURA_DOCS_SITE name different docs addresses.", "Domain");
  }
  if (build.AURA_APP_URL && prod.APP_ORIGIN && origin(build.AURA_APP_URL) !== origin(prod.APP_ORIGIN)) add("build: AURA_APP_URL differs from APP_ORIGIN.", "Domain");

  const prodDb = web.d1_databases?.[0];
  const devDb = web.env?.dev?.d1_databases?.[0];
  if (!prodDb?.database_id || prodDb.database_id === devDb?.database_id) add("web: production D1 is missing or is the dev database.", "Database");
  if (events.d1_databases?.[0]?.database_id !== prodDb?.database_id) add("events: its D1 database differs from the web Worker's.", "Database");

  const producer = web.queues?.producers?.[0]?.queue;
  if (!events.queues?.consumers?.some((consumer) => consumer.queue === producer)) add(`events: doesn't consume the web Worker's queue (${producer}).`, "Queues");
  if (ops.services?.[0]?.service !== web.name) add(`ops: its WEB binding points at ${ops.services?.[0]?.service}, not ${web.name}.`, "Operations app");
  return blockers;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const read = (path) => parseJsonc(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  const blockers = productionBlockers({ web: read("apps/web/wrangler.jsonc"), events: read("apps/events/wrangler.jsonc"), ops: read("apps/ops/wrangler.jsonc"), build: process.env });
  if (!blockers.length) {
    console.log("Production configuration: nothing blocking in wrangler.jsonc. Secrets, Cloudflare settings, and the release gates still need checking by hand.");
  } else {
    console.log(`Production configuration: ${blockers.length} to do (docs/operations/production-launch.md).`);
    for (const { message, step } of blockers) console.log(`- [${step}] ${message}`);
    process.exitCode = 1;
  }
}
