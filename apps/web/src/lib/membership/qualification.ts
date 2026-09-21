export type MembershipTier = "Essential" | "Plus" | "Black" | "Private";
export type QualificationInput = {
  thirtyDayAverageUsd: number;
  monthlyActivityUsd: number;
  paidPlan?: "Plus" | "Black";
  privateInvitation?: boolean;
};

export type Entitlement = { key: string; name: string; allowance: number | null; status: "available" | "planned" | "review_required" };
export type Qualification = { tier: MembershipTier; score: number; route: string; nextTier?: { tier: MembershipTier; balanceGapUsd: number; activityGapUsd: number }; entitlements: Entitlement[] };

const thresholds = {
  Plus: { balance: 10_000, activity: 2_000 },
  Black: { balance: 50_000, activity: 7_500 },
  Private: { balance: 500_000, activity: 25_000 }
} as const;

const tierOrder: MembershipTier[] = ["Essential", "Plus", "Black", "Private"];

function qualifies(input: QualificationInput, tier: keyof typeof thresholds) {
  const threshold = thresholds[tier];
  return input.thirtyDayAverageUsd >= threshold.balance || input.monthlyActivityUsd >= threshold.activity;
}

export function qualifyMembership(input: QualificationInput): Qualification {
  let tier: MembershipTier = "Essential";
  let route = "Base membership";
  if (input.privateInvitation || qualifies(input, "Private")) { tier = "Private"; route = input.privateInvitation ? "Private invitation" : "Relationship balance"; }
  else if (input.paidPlan === "Black" || qualifies(input, "Black")) { tier = "Black"; route = input.paidPlan === "Black" ? "Paid plan" : "Relationship balance or activity"; }
  else if (input.paidPlan === "Plus" || qualifies(input, "Plus")) { tier = "Plus"; route = input.paidPlan === "Plus" ? "Paid plan" : "Relationship balance or activity"; }

  const index = tierOrder.indexOf(tier);
  const next = tierOrder[index + 1] as keyof typeof thresholds | undefined;
  const scoreThreshold = tier === "Essential" ? thresholds.Plus : thresholds[tier as keyof typeof thresholds];
  const score = Math.min(100, Math.round(Math.max(input.thirtyDayAverageUsd / scoreThreshold.balance, input.monthlyActivityUsd / scoreThreshold.activity) * 100));

  return {
    tier, score, route,
    nextTier: next ? { tier: next, balanceGapUsd: Math.max(0, thresholds[next].balance - input.thirtyDayAverageUsd), activityGapUsd: Math.max(0, thresholds[next].activity - input.monthlyActivityUsd) } : undefined,
    entitlements: entitlementsFor(tier)
  };
}

export function entitlementsFor(tier: MembershipTier): Entitlement[] {
  const rank = tierOrder.indexOf(tier);
  return [
    { key: "priority-support", name: "Priority support", allowance: null, status: rank >= 1 ? "available" : "planned" },
    { key: "lounge", name: "Airport lounge visits", allowance: rank >= 3 ? 12 : rank >= 2 ? 4 : 0, status: rank >= 2 ? "planned" : "review_required" },
    { key: "esim", name: "Global eSIM data", allowance: rank >= 3 ? 10 : rank >= 2 ? 3 : 0, status: rank >= 2 ? "planned" : "review_required" },
    { key: "travel-protection", name: "Travel protection", allowance: null, status: rank >= 2 ? "review_required" : "planned" },
    { key: "concierge", name: "Lifestyle concierge", allowance: null, status: rank >= 3 ? "planned" : "review_required" }
  ];
}

