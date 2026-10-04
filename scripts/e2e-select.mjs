#!/usr/bin/env node
// Choose which end-to-end specs a pull request runs, from the files it changes.
// A change to one feature runs that feature's spec plus sign-in-overview as a smoke
// test. Shared code, the e2e support code, config, migrations, and any app file
// this map doesn't recognise run every spec. Files with no effect on the app
// (internal docs, the docs site, the events Worker, unit tests) run none.
// The full suite still runs every night on main and on a pull request labelled full-e2e.
//
//   node scripts/e2e-select.mjs <base-ref>       # diff <base-ref>...HEAD
//   node scripts/e2e-select.mjs --files a b c    # explicit list
// Prints JSON: { "mode": "all" | "some" | "none", "specs": [...], "reasons": {...} }.
// With GITHUB_OUTPUT set, also writes mode, specs (space separated), and a matrix.

import { execFileSync } from "node:child_process";
import { appendFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const specDir = "apps/web/tests/e2e";
const smokeSpec = "sign-in-overview";
export const fullShards = 4;

// Files that only affect things the e2e suite doesn't run.
const noE2e = [
  /^docs\//,
  /^apps\/docs\//,
  /^apps\/events\//,
  /^apps\/web\/tests\/unit\//,
  /^apps\/web\/tests\/e2e\/README\.md$/,
  /^\.claude\//,
  /^scripts\/(?!e2e-select)/,
  /^[^/]+\.md$/,
  /^apps\/[^/]+\/[^/]+\.md$/,
  /^DESIGN\.md$/,
  /^LICENSE/,
  /^\.gitignore$/
];

// Code every page or money action goes through: any change runs every spec.
const shared = [
  /^apps\/web\/tests\/e2e\/support\//,
  /^apps\/web\/(playwright\.config|vite\.config|next\.config|package\.json|wrangler\.jsonc|tsconfig\.json)/,
  /^apps\/web\/worker\//,
  /^apps\/web\/src\/config\//,
  /^apps\/web\/src\/lib\/(actions|auth|http|features|chain|assets|platform|client|testing|format|security|providers|site)\//,
  /^apps\/web\/src\/app\/(app\/)?layout\.tsx$/,
  /^apps\/web\/src\/app\/(globals|shell)\.css$/,
  /^apps\/web\/src\/components\/(app-shell|states|toast|live-amount|status-dot|copy-button|brand|web3-runtime-provider|privy-bridge|terms-gate|action-journey|transaction-progress|payment-actions|sheet)\.tsx$/,
  /^apps\/web\/public\/design-tokens\.css$/,
  /^packages\//,
  /^infra\//,
  /^\.github\//,
  /^package\.json$/,
  /^pnpm-(lock|workspace)\.yaml$/,
  /^scripts\/e2e-select/
];

// Feature specs and the words in a path under apps/web/src or apps/web/public that belong to them.
export const features = {
  bank: ["bank", "api/money/", "lib/money/", "payout"],
  cards: ["card"],
  deposit: ["deposit", "add-from-wallet", "move-previous-account"],
  earn: ["earn", "defi"],
  insights: ["insights"],
  // Perps and predictions share the markets parts (markets-*.ts(x), markets.css, lib/markets/), so those run both.
  perps: ["perps", "markets", "hyperliquid"],
  predictions: ["prediction", "polymarket", "markets"],
  landing: ["app/page.tsx", "public.css", "landing", "waitlist", "unavailable", "robots", "sitemap", "llms.txt", "app/docs/", "guest-banner", "lib/legal/"],
  notifications: ["notification"],
  ops: ["api/ops/", "lib/ops/"],
  product: ["command-menu", "lib/example/", "product-map", "app/app/[section]/", "design-system", "api/health/", "api/webhooks/", "apple-icon", "icon.svg", "manifest", "analytics", "theme"],
  send: ["send", "recipient", "aura-tag", "app/pay/"],
  settings: ["settings", "setting-row", "security", "preferences", "profile", "privacy", "data-rights", "theme", "passkey", "account-closed", "api/account/", "lib/account/"],
  [smokeSpec]: ["overview", "dashboard", "terms", "auth-provider", "account-menu", "api/auth/", "app/app/page.tsx"],
  support: ["support"],
  // The quality-bar sweep covers every page and runs only when asked (AURA_SWEEP), so no path selects it.
  sweep: [],
  swap: ["swap", "api/routes/"],
  transactions: ["transaction", "activity", "statements", "records.css"]
};

export function allSpecs(dir = join(repoRoot, specDir)) {
  return readdirSync(dir).filter((name) => name.endsWith(".spec.ts")).map((name) => name.slice(0, -".spec.ts".length)).sort();
}

export function selectSpecs(files, specs = allSpecs()) {
  const chosen = new Set();
  const reasons = {};
  let all = false;
  for (const file of files) {
    if (shared.some((pattern) => pattern.test(file))) {
      all = true;
      reasons[file] = "shared";
      continue;
    }
    const spec = file.match(/^apps\/web\/tests\/e2e\/([^/]+)\.spec\.ts$/)?.[1];
    if (spec) {
      if (specs.includes(spec)) chosen.add(spec);
      reasons[file] = spec;
      continue;
    }
    if (noE2e.some((pattern) => pattern.test(file))) {
      reasons[file] = "none";
      continue;
    }
    if (file.startsWith("apps/ops/")) {
      chosen.add("ops");
      reasons[file] = "ops";
      continue;
    }
    const appPath = file.match(/^apps\/web\/(?:src|public)\/(.+)$/)?.[1];
    const matched = appPath
      ? Object.entries(features).filter(([, words]) => words.some((word) => appPath.toLowerCase().includes(word))).map(([name]) => name)
      : [];
    if (matched.length === 0) {
      // Not recognised: run everything rather than guess.
      all = true;
      reasons[file] = "unrecognised";
      continue;
    }
    for (const name of matched) chosen.add(name);
    chosen.add(smokeSpec);
    reasons[file] = matched.join(" ");
  }
  if (all) return { mode: "all", specs, reasons };
  const selected = [...chosen].filter((name) => specs.includes(name)).sort();
  return { mode: selected.length ? "some" : "none", specs: selected, reasons };
}

// One job per browser for a focused run; the full suite is split across fullShards jobs per browser.
export function matrix(mode) {
  const projects = ["desktop-chromium", "mobile-chromium"];
  const shards = mode === "all" ? fullShards : 1;
  return { include: projects.flatMap((project) => Array.from({ length: shards }, (_, index) => ({ project, shard: `${index + 1}/${shards}` }))) };
}

function changedFiles(base) {
  return execFileSync("git", ["diff", "--name-only", `${base}...HEAD`], { cwd: repoRoot, encoding: "utf8" }).split("\n").filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const result = args[0] === "--files" ? selectSpecs(args.slice(1)) : args[0] === "--all" ? { mode: "all", specs: allSpecs(), reasons: {} } : selectSpecs(changedFiles(args[0] ?? "origin/main"));
  console.log(JSON.stringify(result, null, 2));
  if (process.env.GITHUB_OUTPUT) {
    const paths = result.specs.map((name) => `tests/e2e/${name}.spec.ts`).join(" ");
    appendFileSync(process.env.GITHUB_OUTPUT, `mode=${result.mode}\nspecs=${result.mode === "all" ? "" : paths}\nmatrix=${JSON.stringify(matrix(result.mode))}\n`);
  }
}
