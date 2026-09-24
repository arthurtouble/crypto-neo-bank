import { expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ batches: 0 }));

vi.mock("@/lib/auth/server", () => ({ requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }), AuthenticationError: class AuthenticationError extends Error {} }));
vi.mock("@/lib/security/audit", () => ({ writeAuditEvent: async () => undefined }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) {
    if (sql.includes("application_id")) throw new Error("application column was removed");
    return { bind() { return this; }, async run() { return { success: true }; } };
  },
  async batch(statements: unknown[]) {
    state.batches++;
    if (state.batches === 1) return [
      { results: [{ status: "active", country_code: "PT", activated_at: "2026-01-01T00:00:00.000Z" }] },
      { results: [{ event_name: "account_secured" }, { event_name: "first_value_completed" }, { event_name: "retained_30d" }] },
      { results: [{ count: 0 }] }, { results: [{ count: 0 }] }
    ];
    return statements.map(() => ({ success: true, meta: { changes: 1 } }));
  }
} } }));

import { POST } from "@/app/api/growth/referrals/route";

it("issues a referral link into the waitlist without application columns", async () => {
  state.batches = 0;
  process.env.GROWTH_ALLOWED_COUNTRIES = "PT";
  process.env.GROWTH_REFERRALS_ENABLED = "true";
  process.env.GROWTH_REFERRAL_LIMIT = "1";
  const response = await POST(new Request("https://aurel.test/api/growth/referrals", { method: "POST" }));
  expect(response.status).toBe(201);
  expect((await response.json() as { referralUrl: string }).referralUrl).toMatch(/^https:\/\/aurel\.test\/waitlist\?referral=/);
});
