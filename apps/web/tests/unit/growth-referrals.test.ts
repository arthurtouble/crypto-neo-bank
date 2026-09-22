import { describe, expect, it } from "vitest";
import { referralEligibility, type ReferralEvidence } from "@/lib/growth/referrals";

const ready: ReferralEvidence = { accessActive: true, accountSecured: true, firstValueCompleted: true, retained: true, accountAgeDays: 35, criticalIssueOpen: false, countryAllowed: true, featureEnabled: true, activeInvites: 0, inviteLimit: 1 };
describe("referral eligibility", () => {
  it("unlocks only from server evidence", () => expect(referralEligibility(ready)).toEqual({ eligible: true, reasons: [] }));
  it.each([["firstValueCompleted","first_value_incomplete"],["retained","retention_incomplete"],["featureEnabled","feature_paused"],["countryAllowed","country_unavailable"]] as const)("blocks missing %s", (key, reason) => expect(referralEligibility({ ...ready, [key]: false })).toEqual(expect.objectContaining({ eligible: false, reasons: expect.arrayContaining([reason]) })));
  it("enforces the active invitation cap", () => expect(referralEligibility({ ...ready, activeInvites: 1 }).reasons).toContain("invite_limit_reached"));
});
