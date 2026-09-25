import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const state = vi.hoisted(() => ({ writes: [] as unknown[][], threshold: 10_000, locked: 0, allowlist: 0, version: 4,
  daily: 25_000, newThreshold: 1_000, delay: 86_400, updateChanges: 1, lastUpdateSql: "" }));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    return { bind(...values: unknown[]) {
      return {
        async first() {
          if (sql.includes("FROM security_profiles")) return {
            account_locked: state.locked, enforce_address_book: state.allowlist, daily_limit_usd: state.daily,
            new_address_threshold_usd: state.newThreshold, new_address_delay_seconds: state.delay,
            step_up_threshold_usd: state.threshold, policy_version: state.version, updated_at: "2026-09-01T00:00:00Z"
          };
          return null;
        },
        async run() {
          if (sql.startsWith("UPDATE security_profiles")) { state.writes.push(values); state.lastUpdateSql = sql; }
          return { meta: { changes: state.updateChanges } };
        }
      };
    } };
  }, async batch(statements: Array<{ run(): Promise<unknown> }>) {
    const results = [];
    for (const statement of statements) results.push(await statement.run());
    return results;
  }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError, requireVerifiedSubject: async () => ({ subjectReference: "subject-a", sessionReference: "session-a" }) }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));

import { GET, PATCH } from "@/app/api/security/policy/route";


function request(stepUpThresholdUsd: number) {
  return PATCH(new Request("https://aurel.test/api/security/policy", {
    method: "PATCH", body: JSON.stringify({ stepUpThresholdUsd })
  }));
}

beforeEach(() => { state.writes.length = 0; state.threshold = 10_000; state.locked = 0; state.allowlist = 0; state.version = 4;
  state.daily = 25_000; state.newThreshold = 1_000; state.delay = 86_400; state.updateChanges = 1; state.lastUpdateSql = ""; });

describe("security policy step-up floor", () => {
  it("increments the policy version on a tightening update and checks the version in the CAS", async () => {
    const response = await PATCH(new Request("https://aurel.test/api/security/policy", {
      method: "PATCH", body: JSON.stringify({ dailyLimitUsd: 20_000 })
    }));
    expect(response.status).toBe(200);
    expect((await response.json() as { policy: { policyVersion: number } }).policy.policyVersion).toBe(5);
    expect(state.lastUpdateSql).toContain("policy_version = policy_version + 1");
    expect(state.lastUpdateSql).toContain("AND policy_version IS ?");
    expect(state.writes[0].at(-1)).toBe(4);
  });

  it("does not present a policy without a valid version as current", async () => {
    state.version = Number.NaN;
    const response = await GET(new Request("https://aurel.test/api/security/policy"));
    expect(response.status).toBe(503);
  });

  it("rejects a request to raise the step-up threshold above 10k without writing", async () => {
    const response = await request(10_001);
    expect(response.status).toBe(400);
    expect((await response.json() as { error: string }).error).toBe("invalid_security_policy");
    expect(state.writes).toHaveLength(0);
  });

  it.each([10_000, 5_000])("accepts a threshold of %i", async (threshold) => {
    const response = await request(threshold);
    expect(response.status).toBe(200);
    expect((await response.json() as { policy: { stepUpThresholdUsd: number } }).policy.stepUpThresholdUsd).toBe(threshold);
    expect(state.writes[0][5]).toBe(threshold);
  });

  it("returns and stores the effective floor when changing a legacy higher-threshold profile", async () => {
    state.threshold = 20_000;
    const response = await PATCH(new Request("https://aurel.test/api/security/policy", {
      method: "PATCH", body: JSON.stringify({ dailyLimitUsd: 20_000 })
    }));
    expect(response.status).toBe(200);
    expect((await response.json() as { policy: { stepUpThresholdUsd: number } }).policy.stepUpThresholdUsd).toBe(10_000);
    expect(state.writes[0][5]).toBe(10_000);
  });

  it("reports the effective floor for a legacy higher-threshold profile", async () => {
    state.threshold = 20_000;
    const response = await GET(new Request("https://aurel.test/api/security/policy"));
    expect(response.status).toBe(200);
    expect((await response.json() as { policy: { stepUpThresholdUsd: number } }).policy.stepUpThresholdUsd).toBe(10_000);
  });

  it.each([
    ["unlock", { accountLocked: false }, { locked: 1 }],
    ["disable saved destinations", { enforceAddressBook: false }, { allowlist: 1 }],
    ["raise daily limit", { dailyLimitUsd: 30_000 }, {}],
    ["raise new-recipient limit", { newAddressThresholdUsd: 2_000 }, {}],
    ["shorten cooling", { newAddressDelayHours: 0 }, {}]
  ] as const)("rejects %s without exact-action step-up", async (_label, input, setup) => {
    Object.assign(state, setup);
    const response = await PATCH(new Request("https://aurel.test/api/security/policy", { method: "PATCH", body: JSON.stringify(input) }));
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("step_up_unavailable");
    expect(state.writes).toHaveLength(0);
  });

  it("rejects a stale concurrent update before audit or analytics writes", async () => {
    state.updateChanges = 0;
    const response = await PATCH(new Request("https://aurel.test/api/security/policy", { method: "PATCH", body: JSON.stringify({ dailyLimitUsd: 20_000 }) }));
    expect(response.status).toBe(409);
    expect((await response.json() as { error: string }).error).toBe("security_policy_changed");
    expect(state.lastUpdateSql).toContain("daily_limit_usd IS ?");
    expect(state.writes).toHaveLength(1);
  });
});
