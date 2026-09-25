import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const apiRoot = resolve(process.cwd(), "src/app/api");
const srcRoot = resolve(process.cwd(), "src");

function files(directory: string, match: (name: string) => boolean): string[] {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name);
    return statSync(path).isDirectory() ? files(path, match) : match(name) ? [path] : [];
  });
}

const routes = files(apiRoot, (name) => name === "route.ts").map((path) => ({
  path: relative(apiRoot, path).replace(/\/route\.ts$/, ""),
  source: readFileSync(path, "utf8")
}));

/** Public or special-contract routes that intentionally do not use the shared wrapper. */
const unwrapped: Record<string, string> = {
  "health": "public liveness probe with its own dependency report",
  "status": "public status page data",
  "auth/session": "session probe returns authenticated:false rather than an error body",
  "aura-tags/[tag]": "public payment page; every failure is an indistinguishable 404",
  "webhooks/provider": "signature-verified provider ingress with its own replay handling",
  "markets/instruments": "public, cacheable catalog",
  "demo/commands": "fictional example data only",
  "demo/scenarios": "fictional example data only",
  "demo/session": "fictional example data only"
};

describe("API route inventory", () => {
  it("wraps every handler except the listed public or special-contract routes", () => {
    const bare = routes.filter((item) => /export (async )?function (GET|POST|PUT|PATCH|DELETE)\b/.test(item.source)
      || !/\broute\(/.test(item.source)).map((item) => item.path).sort();
    expect(bare).toEqual(Object.keys(unwrapped).sort());
  });

  it("keeps the allowlist free of routes that no longer exist", () => {
    const existing = new Set(routes.map((item) => item.path));
    expect(Object.keys(unwrapped).filter((path) => !existing.has(path))).toEqual([]);
  });

  it("does not reintroduce retired or invitation-only endpoints", () => {
    const retired = ["goals", "bills", "income-plan", "transfer-schedules", "swap/reminders", "swap/alerts", "market-data",
      "reconcile", "portfolio", "beta/access", "beta/feedback", "ops/beta", "routing/quote", "swap/curated-quote",
      "growth/waitlist", "growth/referrals", "growth/events", "growth/experiments", "ops/growth/campaigns",
      "ops/growth/experiments", "ops/growth/communications", "ops/growth/waitlist", "growth/consent", "growth/data-requests",
      "ops/growth/data-requests"];
    const existing = new Set(routes.map((item) => item.path));
    expect(retired.filter((path) => existing.has(path))).toEqual([]);
  });
});

describe("open access", () => {
  const sources = files(srcRoot, (name) => /\.(ts|tsx)$/.test(name)).map((path) => ({
    path: relative(srcRoot, path), source: readFileSync(path, "utf8")
  }));

  it("has no invitation, cohort, or beta-country gate left in application code", () => {
    const offenders = sources.filter(({ source }) =>
      /lib\/beta\/access|requireBetaAccess|BetaAccessError|configuredCountries|beta_access|beta_invites|BETA_ACCESS_MODE|BETA_ALLOWED_COUNTRIES/.test(source))
      .map(({ path }) => path);
    expect(offenders).toEqual([]);
  });

  it("gates every money-moving route on a server-side feature switch", () => {
    const financial = ["intents/prepare", "intents/evaluate", "swap/review", "swap/prepare", "swap/approval",
      "defi/aave/action", "defi/sky/action", "markets/orders"];
    const missing = financial.filter((path) => {
      const source = routes.find((item) => item.path === path)?.source ?? "";
      return !/requireFeature\(|featureEnabled\(|requireEnabled\(/.test(source);
    });
    expect(missing).toEqual([]);
  });
});
