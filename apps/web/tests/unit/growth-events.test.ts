import { describe, expect, it } from "vitest";
import { publicEventsBatchSchema, retentionDecision } from "@/lib/growth/events";

describe("public growth events", () => {
  const base = { anonymousSessionId: "f5ba9bbc-4318-4fcb-8649-c9b3be2c315e", surface: "/", properties: {} };
  it("accepts bounded public facts", () => expect(publicEventsBatchSchema.parse({ events: [{ ...base, eventName: "landing_viewed" }] }).events).toHaveLength(1));
  it.each(["application_qualified", "invite_issued", "retained_30d", "first_value_completed"])("rejects server fact %s", (eventName) => expect(() => publicEventsBatchSchema.parse({ events: [{ ...base, eventName }] })).toThrow());
  it("rejects unknown properties and cross-origin surfaces", () => {
    expect(() => publicEventsBatchSchema.parse({ events: [{ ...base, eventName: "landing_viewed", surface: "https://example.com", properties: { email: "person@example.com" } }] })).toThrow();
  });
});

describe("retention rule", () => {
  const activationAt = new Date("2026-01-01T00:00:00Z");
  it("does not mature early", () => expect(retentionDecision({ activationAt, now: new Date("2026-01-20T00:00:00Z"), hasMeaningfulEvent: true })).toBe("not_due"));
  it("requires a meaningful return in the day 21–37 window", () => expect(retentionDecision({ activationAt, returnedAt: new Date("2026-01-31T00:00:00Z"), now: new Date("2026-02-01T00:00:00Z"), hasMeaningfulEvent: true })).toBe("retained"));
});
