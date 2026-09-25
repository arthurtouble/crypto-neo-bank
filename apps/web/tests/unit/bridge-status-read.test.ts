import { beforeEach, describe, expect, it, vi } from "vitest";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const intentId = "00000000-0000-4000-8000-000000000001";
const fixture = vi.hoisted(() => ({ source: "confirmed", destination: "partial", status: "submitted" }));
vi.mock("cloudflare:workers", () => ({ env: { PROJECTION_DB: {
  prepare(sql: string) { return { bind() { return { async first() {
    if (!sql.includes("FROM transaction_intents")) return null;
    return { intent_id: intentId, status: fixture.status, type: "bridge", chain_id: 8453,
      transaction_hash: `0x${"a".repeat(64)}`, route_reference: "swap-plan:plan-1",
      failure_reason: null, updated_at: "2026-09-23T00:00:00.000Z", confirmed_at: null,
      verification_state: "pending", source_verification_state: fixture.source, destination_verification_state: fixture.destination,
      destination_transaction_hash: `0x${"b".repeat(64)}` };
  } }; } }; }
} } }));
vi.mock("@/lib/auth/server", () => ({ AuthenticationError: httpErrors.AuthenticationError,
  requireVerifiedSubject: async () => ({ subjectReference: "subject-a" }) }));

import { GET } from "@/app/api/intents/status/route";


describe("bridge status", () => {
  beforeEach(() => { fixture.source = "confirmed"; fixture.destination = "partial"; fixture.status = "submitted"; });
  it("shows a source-confirmed partial delivery separately from final settlement", async () => {
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ status: "submitted", verificationState: "partial",
      sourceVerificationState: "confirmed", destinationTransactionHash: `0x${"b".repeat(64)}` });
  });

  it("does not present a completed destination when source finality was lost", async () => {
    fixture.source = "reorged"; fixture.destination = "complete";
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(await response.json()).toMatchObject({ status: "submitted", verificationState: "reorged" });
  });

  it("does not present destination completion before the intent is confirmed", async () => {
    fixture.destination = "complete";
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(await response.json()).not.toMatchObject({ verificationState: "complete" });
  });

  it("presents full completion only when source, destination, and intent agree", async () => {
    fixture.destination = "complete"; fixture.status = "confirmed";
    const response = await GET(new Request(`https://aurel.test/api/intents/status?intentId=${intentId}`));
    expect(await response.json()).toMatchObject({ status: "confirmed", verificationState: "confirmed" });
  });
});
