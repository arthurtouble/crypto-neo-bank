import { describe, expect, it } from "vitest";
import { hasConsent, lifecycleMessageSchema, lifecycleTemplates, LocalLifecycleMessenger } from "@/lib/growth/lifecycle";

describe("lifecycle messaging", () => {
  it("keeps operational and marketing purposes distinct", () => {
    expect(lifecycleTemplates.private_beta_invitation.purpose).toBe("beta_operational");
    expect(lifecycleTemplates.monthly_trust_update.purpose).toBe("marketing");
  });
  it("rejects unknown templates and unbounded variables", () => expect(() => lifecycleMessageSchema.parse({ recipientReference: "subject-1", purpose: "marketing", templateKey: "sales_blast", templateVersion: "v1", variables: {}, idempotencyKey: "message-123" })).toThrow());
  it("provides an idempotency-addressed local adapter", async () => expect(await new LocalLifecycleMessenger().send({ recipientReference: "subject-1", purpose: "marketing", templateKey: "monthly_trust_update", templateVersion: "v1", variables: {}, idempotencyKey: "message-123" })).toEqual({ providerReference: "local:message-123", status: "accepted" }));
  it("checks subject consent without application records", async () => {
    const db = { prepare(sql: string) {
      if (sql.includes("growth_applications") || sql.includes("growth_subject_links")) throw new Error("application table must not be queried");
      return { bind() { return { async first() { return { action: "granted" }; } }; } };
    } } as unknown as D1Database;
    expect(await hasConsent(db, "subject-1", "marketing")).toBe(true);
  });
});
