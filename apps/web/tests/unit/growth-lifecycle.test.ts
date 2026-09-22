import { describe, expect, it } from "vitest";
import { lifecycleMessageSchema, lifecycleTemplates, LocalLifecycleMessenger } from "@/lib/growth/lifecycle";

describe("lifecycle messaging", () => {
  it("keeps operational and marketing purposes distinct", () => {
    expect(lifecycleTemplates.application_received.purpose).toBe("beta_operational");
    expect(lifecycleTemplates.monthly_trust_update.purpose).toBe("marketing");
  });
  it("rejects unknown templates and unbounded variables", () => expect(() => lifecycleMessageSchema.parse({ recipientReference: "subject-1", purpose: "marketing", templateKey: "sales_blast", templateVersion: "v1", variables: {}, idempotencyKey: "message-123" })).toThrow());
  it("provides an idempotency-addressed local adapter", async () => expect(await new LocalLifecycleMessenger().send({ recipientReference: "subject-1", purpose: "marketing", templateKey: "monthly_trust_update", templateVersion: "v1", variables: {}, idempotencyKey: "message-123" })).toEqual({ providerReference: "local:message-123", status: "accepted" }));
});
