import { describe, expect, it } from "vitest";
import { buildDemoSession, executeDemoCommand } from "../../src/lib/providers/session";
import { commandRequestSchema } from "../../src/lib/providers/validation";
import { reconcileSession } from "../../src/lib/reconciliation";

describe("provider-neutral sandbox", () => {
  it("rebuilds a funded relationship exclusively from provider observations", async () => {
    const session = await buildDemoSession("funded");
    expect(session.positions).toHaveLength(2);
    expect(session.positions.map((position) => position.category)).not.toContain("connected");
    expect(session.compliance.status).toBe("approved");
    expect(session.wallets[0]?.control).toBe("embedded-noncustodial");
    expect(session.positions.every((position) => position.source.externalId && position.source.observedAt)).toBe(true);
  });

  it("keeps regulated features locked during provider review", async () => {
    const session = await buildDemoSession("compliance_review");
    expect(session.positions.some((position) => position.category === "liquid")).toBe(false);
    expect(session.compliance.requiredActions).toContain("Confirm source of funds");
    expect(reconcileSession(session).status).toBe("attention");
  });

  it("returns a failure receipt without claiming a balance changed", async () => {
    const receipt = await executeDemoCommand("transfer_failed", { type: "withdraw", subjectReference: "demo-user-001", amount: "1000.00", asset: "USDC", destinationReference: "saved:test" }, "idem-test-001");
    expect(receipt.status).toBe("failed");
    expect(receipt.failure?.code).toBe("destination_rejected");
  });

  it("rejects zero-value commands before they reach a provider", () => {
    expect(() => commandRequestSchema.parse({ scenarioId: "funded", idempotencyKey: "idem-test-002", command: { type: "deposit", subjectReference: "demo-user-001", amount: "0", asset: "USD", rail: "bank" } })).toThrow();
  });
});
