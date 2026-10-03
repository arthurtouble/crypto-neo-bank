import assert from "node:assert/strict";
import test from "node:test";
import { allSpecs, features, fullShards, matrix, selectSpecs } from "./e2e-select.mjs";

test("every feature in the map has a spec, and every spec is in the map", () => {
  assert.deepEqual(Object.keys(features).sort(), allSpecs());
});

test("a change to one feature runs its spec and the sign-in smoke test", () => {
  const result = selectSpecs(["apps/web/src/components/send-page.tsx", "apps/web/src/app/api/recipients/route.ts"]);
  assert.equal(result.mode, "some");
  assert.deepEqual(result.specs, ["send", "sign-in-overview"]);
});

test("a Markets screen or route runs the markets spec", () => {
  assert.deepEqual(selectSpecs(["apps/web/src/components/perps-sheets.tsx", "apps/web/src/app/markets.css"]).specs, ["markets", "sign-in-overview"]);
  assert.deepEqual(selectSpecs(["apps/web/src/app/api/predictions/history/route.ts"]).specs, ["markets", "sign-in-overview"]);
});

test("a changed spec runs itself", () => {
  assert.deepEqual(selectSpecs(["apps/web/tests/e2e/cards.spec.ts"]).specs, ["cards"]);
});

test("the operations app runs the operations spec", () => {
  assert.deepEqual(selectSpecs(["apps/ops/src/main.tsx"]).specs, ["ops"]);
});

test("shared code, e2e support, migrations, and config run every spec", () => {
  for (const file of [
    "apps/web/src/lib/actions/verify.ts",
    "apps/web/src/lib/auth/access.ts",
    "apps/web/tests/e2e/support/fake-edge.mjs",
    "infra/d1/migrations/0005_example.sql",
    "packages/provider-projections/src/index.ts",
    "pnpm-lock.yaml",
    ".github/workflows/ci.yml",
    "apps/web/public/design-tokens.css"
  ]) {
    assert.equal(selectSpecs([file]).mode, "all", file);
  }
});

test("an app file the map doesn't recognise runs every spec", () => {
  assert.equal(selectSpecs(["apps/web/src/components/money-page.tsx"]).mode, "all");
});

test("docs, the events Worker, and unit tests run no e2e", () => {
  const result = selectSpecs(["docs/README.md", "apps/docs/src/content/docs/index.md", "apps/events/src/index.ts", "apps/web/tests/unit/send.test.ts", "CLAUDE.md"]);
  assert.equal(result.mode, "none");
  assert.deepEqual(result.specs, []);
});

test("one shared file among feature files still runs everything", () => {
  assert.equal(selectSpecs(["apps/web/src/components/swap-page.tsx", "apps/web/src/lib/http/route.ts"]).mode, "all");
});

test("a full run is split into shards per browser; a focused run is one job per browser", () => {
  assert.equal(matrix("all").include.length, 2 * fullShards);
  assert.deepEqual(matrix("some").include, [{ project: "desktop-chromium", shard: "1/1" }, { project: "mobile-chromium", shard: "1/1" }]);
});
