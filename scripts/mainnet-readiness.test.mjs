import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const mock = fileURLToPath(new URL("./mainnet-readiness.mock.mjs", import.meta.url));
const script = fileURLToPath(new URL("./mainnet-readiness.mjs", import.meta.url));
const run = (extra = {}) => spawnSync(process.execPath, ["--import", mock, script], { encoding: "utf8", env: { ...process.env, ...extra } });

test("readiness checks the governed Aave Base Pool through the live address provider", () => {
  const result = run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /PASS  Aave Base: .*active Pool.*deployed code/);
});

test("readiness fails closed when the address provider points to another Pool", () => {
  const result = run({ AUREL_TEST_BAD_POOL: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL  Aave Base Pool differs/);
});

test("readiness fails closed when a governed Aave contract has no code", () => {
  for (const target of ["provider", "pool", "usdc", "weth"]) {
    const result = run({ AUREL_TEST_MISSING_CODE: target });
    assert.equal(result.status, 1, `${target}: ${result.stderr}`);
    assert.match(result.stderr, /FAIL  Aave Base has no contract code/);
  }
});

test("readiness rejects malformed contract-code responses", () => {
  const result = run({ AUREL_TEST_MALFORMED_CODE: "1" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /FAIL  Aave Base has invalid contract code/);
});
