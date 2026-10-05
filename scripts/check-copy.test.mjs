import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { banned, compare, findings } from "./check-copy.mjs";

const flagged = (text) => banned.filter((rule) => rule.pattern.test(text)).map((rule) => text.match(rule.pattern)[0]);

test("flags the glossary's banned words and error phrasing, not the plain words that replace them", () => {
  assert.deepEqual(flagged("We couldn't read your positions."), ["We couldn't"]);
  assert.deepEqual(flagged("We couldn&apos;t load your Aura tag."), ["We couldn&apos;t"]);
  assert.deepEqual(flagged("We didn't receive it in time."), ["We didn't"]);
  assert.deepEqual(flagged("The bridge fee comes out of the amount."), ["bridge fee"]);
  assert.deepEqual(flagged("Supplied to the protocol, settled onchain."), ["protocol", "onchain", "settled"]);
  assert.deepEqual(flagged("Polymarket's markets can't be loaded right now."), []);
  assert.deepEqual(flagged("We never hold your money. Moving fee $0.40. Completed."), []);
  assert.deepEqual(flagged("Choose a route in the menu"), ["a route"]);
  assert.deepEqual(flagged("Routes and pages"), []);
});

test("no file has more banned words than the baseline allows", () => {
  const baseline = JSON.parse(readFileSync(new URL("./copy-baseline.json", import.meta.url), "utf8"));
  const { over } = compare(findings(), baseline);
  assert.deepEqual(over, [], "Rewrite the new copy with docs/product/content-style-guide.md#glossary, or run `pnpm copy:check` to see where");
});

test("the baseline only shrinks: a file at zero isn't listed", () => {
  const baseline = JSON.parse(readFileSync(new URL("./copy-baseline.json", import.meta.url), "utf8"));
  assert.equal(Object.values(baseline).some((count) => count === 0), false);
});
