import { describe, expect, it } from "vitest";
import { qualifyMembership } from "@/lib/membership/qualification";

describe("membership qualification", () => {
  it("uses the higher of balance and activity qualification routes", () => {
    expect(qualifyMembership({ thirtyDayAverageUsd: 2_000, monthlyActivityUsd: 8_000 }).tier).toBe("Black");
    expect(qualifyMembership({ thirtyDayAverageUsd: 55_000, monthlyActivityUsd: 0 }).tier).toBe("Black");
  });

  it("allows a paid plan without inventing relationship balance", () => {
    const result = qualifyMembership({ thirtyDayAverageUsd: 0, monthlyActivityUsd: 0, paidPlan: "Plus" });
    expect(result.tier).toBe("Plus");
    expect(result.route).toBe("Paid plan");
  });

  it("reserves private concierge for Private", () => {
    const black = qualifyMembership({ thirtyDayAverageUsd: 60_000, monthlyActivityUsd: 0 });
    const privateTier = qualifyMembership({ thirtyDayAverageUsd: 510_000, monthlyActivityUsd: 0 });
    expect(black.entitlements.find((item) => item.key === "concierge")?.status).toBe("review_required");
    expect(privateTier.entitlements.find((item) => item.key === "concierge")?.status).toBe("planned");
  });
});

