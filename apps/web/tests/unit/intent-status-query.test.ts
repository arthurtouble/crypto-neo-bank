import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  query: "",
  subjectReference: "subject-a"
}));

vi.mock("cloudflare:workers", () => ({
  env: {
    PROJECTION_DB: {
      prepare(query: string) {
        fixture.query = query;
        if (!/intent_type\s+AS\s+type/i.test(query)) {
          throw new Error("D1_ERROR: no such column: type");
        }
        return {
          bind(intentId: string, subjectReference: string) {
            return {
              async first() {
                if (subjectReference !== fixture.subjectReference) return null;
                return {
                  intent_id: intentId,
                  status: "submitted",
                  type: "swap",
                  chain_id: 8453,
                  transaction_hash: null,
                  route_reference: null,
                  failure_reason: null,
                  updated_at: "2026-09-22T00:00:00.000Z",
                  confirmed_at: null
                };
              }
            };
          }
        };
      }
    }
  }
}));

vi.mock("@/lib/auth/server", () => ({
  AuthenticationError: class AuthenticationError extends Error {},
  requireVerifiedSubject: async () => ({ subjectReference: fixture.subjectReference })
}));

import { GET } from "@/app/api/intents/status/route";

const intentId = "00000000-0000-4000-8000-000000000001";

describe("intent status query", () => {
  beforeEach(() => { fixture.query = ""; fixture.subjectReference = "subject-a"; });

  it("reads the migrated intent_type column and keeps the public type field", async () => {
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ intentId, type: "swap", status: "submitted" });
    expect(fixture.query).toMatch(/intent_type\s+AS\s+type/i);
    expect(fixture.query).toMatch(/WHERE intent_id = \? AND subject_reference = \?/i);
  });
});
