import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ writes: [] as unknown[][], threshold: 10_000 }));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    return { bind(...values: unknown[]) {
      return {
        async first() {
          if (sql.includes("FROM security_profiles")) return {
            account_locked: 0, enforce_address_book: 0, daily_limit_usd: 25_000,
            new_address_threshold_usd: 1_000, new_address_delay_seconds: 86_400,
            step_up_threshold_usd: state.threshold, updated_at: "2026-09-01T00:00:00Z"
          };
          return null;
        },
        async run() { state.writes.push(values); return { meta: { changes: 1 } }; }
      };
    } };
  }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: "subject-a", sessionReference: "session-a" }) }));
vi.mock("@/lib/profile/ensure", () => ({ ensureSubjectProfile: async () => undefined }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));

import { GET, PATCH } from "@/app/api/security/policy/route";

function request(stepUpThresholdUsd: number) {
  return PATCH(new Request("https://aurel.test/api/security/policy", {
    method: "PATCH", body: JSON.stringify({ stepUpThresholdUsd })
  }));
}

beforeEach(() => { state.writes.length = 0; state.threshold = 10_000; });

describe("security policy step-up floor", () => {
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
});
