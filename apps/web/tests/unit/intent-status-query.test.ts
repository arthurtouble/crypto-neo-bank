import { beforeEach, describe, expect, it, vi } from "vitest";

const fixture = vi.hoisted(() => ({
  query: "",
  subjectReference: "subject-a",
  status: "submitted",
  verificationState: "pending"
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
                  status: fixture.status,
                  verification_state: fixture.verificationState,
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
  beforeEach(() => { fixture.query = ""; fixture.subjectReference = "subject-a"; fixture.status = "submitted"; fixture.verificationState = "pending"; });

  it("reads the migrated intent_type column and keeps the public type field", async () => {
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ intentId, type: "swap", status: "submitted" });
    expect(fixture.query).toMatch(/intent_type\s+AS\s+type/i);
    expect(fixture.query).toMatch(/WHERE intent_id = \? AND subject_reference = \?/i);
  });

  it("marks historical receipt-only confirmations as unverified legacy evidence", async () => {
    fixture.status = "confirmed";
    fixture.verificationState = "unverified_legacy";
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(await response.json()).toMatchObject({ status: "confirmed", verificationState: "unverified_legacy" });
    expect(fixture.query).toMatch(/FROM intent_prepared_calls p/i);
  });
});
