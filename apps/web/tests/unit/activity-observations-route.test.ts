import { describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ subject: "subject-a", queries: [] as Array<{ sql: string; binds: unknown[] }> }));

vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    const query = { sql, binds: [] as unknown[] };
    state.queries.push(query);
    return { bind(...binds: unknown[]) { query.binds = binds; return this; }, async all() {
      if (sql.includes("intent_observation_candidates")) return { results: [{ report_id: "report-a", subject_reference: "subject-a", intent_id: "intent-a", step_index: 0, chain_id: 8453, transaction_hash: `0x${"a".repeat(64)}`, verification_state: "settled", effect_reason: null, reported_at: "2026-09-23T10:00:00Z", last_checked_at: "2026-09-23T10:05:00Z" }] };
      return { results: [] };
    } };
  }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: class extends Error {}, requireVerifiedSubject: async () => ({ subjectReference: state.subject }) }));
vi.mock("@/lib/security/rate-limit", () => ({ RateLimitError: class extends Error {}, enforceRateLimit: async () => undefined }));
vi.mock("@/lib/defi/aave", () => ({ getAaveBaseActivity: async () => ({ items: [], partial: false, sourceStatus: "none" }) }));

import { GET } from "@/app/api/activity/route";

describe("Activity late transfer observations", () => {
  it("returns subject-owned observations separately from approved intents", async () => {
    state.queries = [];
    const response = await GET(new Request("https://aurel.test/api/activity"));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = await response.json() as { intents: unknown[]; observations: unknown[] };
    expect(body.intents).toEqual([]);
    expect(body.observations).toEqual([{ reportId: "report-a", intentId: "intent-a", stepIndex: 0, chainId: 8453, transactionHash: `0x${"a".repeat(64)}`, status: "Transfer settled — approval review needed", reportedAt: "2026-09-23T10:00:00Z", lastCheckedAt: "2026-09-23T10:05:00Z" }]);
    expect(state.queries.find(({ sql }) => sql.includes("intent_observation_candidates"))).toMatchObject({ binds: ["subject-a"] });
  });
});
