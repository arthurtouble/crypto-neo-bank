import type { ProviderEligibilityDecision } from "@/lib/markets/eligibility";

export type EligibilityProvider = {
  evaluate(input: { subjectReference: string; instrumentId: string }): Promise<ProviderEligibilityDecision>;
};

export function createUnavailableEligibilityProvider(now: () => number = Date.now): EligibilityProvider {
  return {
    async evaluate(input) {
      const observedAt = new Date(now()).toISOString();
      return {
        provider: "not_connected", decisionReference: "", evidenceReference: "", ruleVersion: "none",
        subjectReference: input.subjectReference, instrumentId: input.instrumentId, status: "unavailable", reasonCode: "partner_not_connected",
        residencyCountry: null, nationalityCountries: [], customerClass: null, identityVerifiedUntil: null,
        permissions: { canQuote: false, canOrder: false, canHold: false, canTransfer: false }, restrictedInstrumentIds: [], venuePermissions: [],
        evaluatedAt: observedAt, expiresAt: observedAt
      };
    }
  };
}
