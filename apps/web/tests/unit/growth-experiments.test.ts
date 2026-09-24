import { describe, expect, it } from "vitest";
import { allowedExperimentMetrics, experimentSchema } from "@/lib/growth/experiments";
describe("growth experiments", () => {
  it("limits experiments to approved acquisition metrics", () => expect(allowedExperimentMetrics).not.toContain("transaction_limit"));
  it("rejects a financial or security metric", () => expect(() => experimentSchema.parse({ name: "Risk copy", hypothesis: "Hiding risk improves conversion", primaryMetric: "transaction_limit", variants: ["a","b"], guardrails: [], status: "running" })).toThrow());
  it("requires multiple bounded variants", () => expect(() => experimentSchema.parse({ name: "Hero", hypothesis: "A focused hero improves joins", primaryMetric: "waitlist_joined_rate", variants: ["only"], guardrails: [], status: "draft" })).toThrow());
});
