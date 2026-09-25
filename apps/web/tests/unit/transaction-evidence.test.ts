import { describe, expect, it } from "vitest";
import { sqliteWithIntent } from "../support/schema";
import { matchesPreparedCall, normalizePreparedCall } from "@/lib/transactions/evidence";

const sender = "0x000000000000000000000000000000000000dEaD";
const recipient = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const call = { chainId: 8453, from: sender, to: recipient, value: "1000", data: "0x1234" };

describe("prepared transaction evidence", () => {
  it("normalizes address case and integer value to one fingerprint", async () => {
    const first = await normalizePreparedCall(call);
    const second = await normalizePreparedCall({ ...call, from: sender.toLowerCase(), to: recipient.toLowerCase(), value: 1000n, data: "0x1234" });
    expect(first).toMatchObject({ chainId: 8453, from: sender, to: recipient, value: "1000", data: "0x1234" });
    expect(first.dataHash).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.fingerprint).toMatch(/^0x[0-9a-f]{64}$/);
    expect(first.fingerprint).toBe(second.fingerprint);
  });

  it.each([
    ["chain", { chainId: 1 }],
    ["from", { from: "0x0000000000000000000000000000000000000001" }],
    ["to", { to: "0x0000000000000000000000000000000000000002" }],
    ["value", { value: "1001" }],
    ["data", { data: "0x5678" }]
  ] as const)("rejects changed %s when matching observed transaction", async (reason, change) => {
    const prepared = await normalizePreparedCall(call);
    const observed = { ...call, ...change };
    expect(await matchesPreparedCall(prepared, observed)).toEqual({ matches: false, reason });
  });

  it("matches the same call when observed addresses have different case", async () => {
    const prepared = await normalizePreparedCall(call);
    expect(await matchesPreparedCall(prepared, { ...call, from: sender.toLowerCase(), to: recipient.toLowerCase(), value: 1000n })).toEqual({ matches: true });
  });

  it.each(["-1", "1.0", "1e3", " 1", "", "115792089237316195423570985008687907853269984665640564039457584007913129639936"])("rejects non-canonical or out-of-range value %s", async (value) => {
    await expect(normalizePreparedCall({ ...call, value })).rejects.toThrow();
  });

  it.each(["1234", "0x1", "0xgg", "0X1234"])("rejects malformed calldata %s", async (data) => {
    await expect(normalizePreparedCall({ ...call, data })).rejects.toThrow();
  });

  it("rejects unsupported chain and malformed addresses", async () => {
    await expect(normalizePreparedCall({ ...call, chainId: 0 })).rejects.toThrow();
    await expect(normalizePreparedCall({ ...call, from: "0x1234" })).rejects.toThrow();
  });
});

describe("prepared call migration", () => {
  const row = `INSERT INTO intent_prepared_calls
    (intent_id, step_index, subject_reference, wallet_address, chain_id, target_address, native_value, calldata_hash, call_fingerprint, semantic_action, source_reference, expires_at, expected_effect_json, verification_state, created_at, submission_phase)
    VALUES ('intent-1', 0, 'subject-1', '${sender.toLowerCase()}', 8453, '${recipient.toLowerCase()}', '1000', '0xabc', '0xdef', 'swap', 'quote-1', '2026-09-22T00:00:00Z', '{}', 'prepared', '2026-09-21T00:00:00Z', 'legacy');`;
  const sqlite = sqliteWithIntent;

  it("creates a prepared record under an existing intent", () => {
    const result = sqlite(`${row} SELECT intent_id, step_index, verification_state FROM intent_prepared_calls;`);
    expect(result.status).toBe(0);
    expect(result.stdout.trim()).toBe("intent-1|0|prepared");
  });

  it("rejects an orphan prepared record", () => {
    const result = sqlite(row.replace("'intent-1', 0", "'missing', 0"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("FOREIGN KEY constraint failed");
  });

  it("keeps prepared identity immutable while allowing evidence updates", () => {
    const valid = sqlite(`${row} UPDATE intent_prepared_calls SET reported_hash = '0x${"a".repeat(64)}', verification_state = 'reported' WHERE intent_id = 'intent-1' AND step_index = 0; SELECT verification_state FROM intent_prepared_calls;`);
    expect(valid.status).toBe(0);
    expect(valid.stdout.trim()).toBe("reported");
    const invalid = sqlite(`${row} UPDATE intent_prepared_calls SET target_address = '0x0000000000000000000000000000000000000001' WHERE intent_id = 'intent-1' AND step_index = 0;`);
    expect(invalid.status).not.toBe(0);
  });

  it("does not bind one chain hash to two prepared steps", () => {
    const hash = `0x${"b".repeat(64)}`;
    const secondRow = row.replace("'intent-1', 0", "'intent-1', 1").replace("'quote-1'", "'quote-2'");
    const result = sqlite(`${row} ${secondRow} UPDATE intent_prepared_calls SET reported_hash = '${hash}' WHERE intent_id = 'intent-1';`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("UNIQUE constraint failed");
  });

  it("treats hex hash case as the same chain transaction", () => {
    const secondRow = row.replace("'intent-1', 0", "'intent-1', 1").replace("'quote-1'", "'quote-2'");
    const result = sqlite(`${row} ${secondRow} UPDATE intent_prepared_calls SET reported_hash = CASE step_index WHEN 0 THEN '0x${"a".repeat(64)}' ELSE '0x${"A".repeat(64)}' END WHERE intent_id = 'intent-1';`);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("UNIQUE constraint failed");
  });

  it("requires a fingerprint for each prepared call", () => {
    const result = sqlite(row.replace("'0xdef', 'swap'", "NULL, 'swap'"));
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("NOT NULL constraint failed");
  });
});
