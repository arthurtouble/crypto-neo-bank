import { describe, expect, it } from "vitest";
import { evaluateRegulatedEligibility, type EligibilityEvaluationInput } from "@/lib/markets/eligibility";
import { createUnavailableEligibilityProvider } from "@/lib/markets/eligibility-provider";

const now = Date.parse("2026-09-22T12:00:00.000Z");

function input(overrides: Partial<EligibilityEvaluationInput> = {}): EligibilityEvaluationInput {
  return {
    subjectReference: "did:privy:subject-1", instrumentId: "xstocks:issuer-aapl", now,
    policy: {
      instrumentId: "xstocks:issuer-aapl", allowedCountries: ["PT"], blockedCountries: ["US"],
      provenance: "legal-matrix-v1", reviewedAt: "2026-09-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z",
      venue: "contracted-venue", requiredDocuments: [{ key: "final-terms", version: "v2", effectiveAt: "2026-09-01T00:00:00.000Z", expiresAt: "2027-01-01T00:00:00.000Z" }]
    },
    providerDecision: {
      provider: "contracted-kyc", decisionReference: "decision-1", evidenceReference: "evidence-1", ruleVersion: "rules-v1",
      subjectReference: "did:privy:subject-1", instrumentId: "xstocks:issuer-aapl", status: "eligible",
      residencyCountry: "PT", nationalityCountries: ["PT"], customerClass: "retail", identityVerifiedUntil: "2027-01-01T00:00:00.000Z",
      permissions: { canQuote: true, canOrder: true, canHold: true, canTransfer: true }, restrictedInstrumentIds: [],
      venuePermissions: [{ venue: "contracted-venue", status: "active", expiresAt: "2027-01-01T00:00:00.000Z" }],
      evaluatedAt: "2026-09-22T11:59:00.000Z", expiresAt: "2026-09-22T12:15:00.000Z"
    },
    acknowledgements: [{ subjectReference: "did:privy:subject-1", documentKey: "final-terms", documentVersion: "v2", acceptedAt: "2026-09-20T00:00:00.000Z", evidenceReference: "consent-1" }],
    ...overrides
  };
}

function decision() { return input().providerDecision!; }

describe("regulated instrument eligibility", () => {
  it("does not treat a Privy-authenticated subject or profile country as provider eligibility", async () => {
    const decision = await createUnavailableEligibilityProvider().evaluate({ subjectReference: "did:privy:subject-1", instrumentId: "xstocks:issuer-aapl" });
    const result = evaluateRegulatedEligibility(input({ providerDecision: decision }), now);
    expect(result.permissions).toEqual({ canQuote: false, canOrder: false, canHold: false, canTransfer: false });
    expect(result.reasons).toContain("partner_not_connected");
  });

  it.each([
    ["U.S. person abroad", { providerDecision: { ...decision(), residencyCountry: "PT", nationalityCountries: ["US"] } }, "country_restricted"],
    ["restricted residence", { providerDecision: { ...decision(), residencyCountry: "US" } }, "country_restricted"],
    ["unknown residence", { providerDecision: { ...decision(), residencyCountry: null } }, "country_unknown"],
    ["unknown nationality", { providerDecision: { ...decision(), nationalityCountries: [] } }, "country_unknown"],
    ["unknown customer class", { providerDecision: { ...decision(), customerClass: null } }, "customer_class_unknown"],
    ["stale KYC", { providerDecision: { ...decision(), identityVerifiedUntil: "2026-09-22T11:00:00.000Z" } }, "identity_stale"],
    ["provider outage", { providerDecision: null }, "provider_unavailable"],
    ["asset restriction", { providerDecision: { ...decision(), restrictedInstrumentIds: ["xstocks:issuer-aapl"] } }, "asset_restricted"],
    ["expired venue permission", { providerDecision: { ...decision(), venuePermissions: [{ venue: "contracted-venue", status: "active" as const, expiresAt: "2026-09-22T11:00:00.000Z" }] } }, "venue_permission_expired"]
  ])("fails closed for %s", (_label, overrides, reason) => {
    const result = evaluateRegulatedEligibility(input(overrides as Partial<EligibilityEvaluationInput>), now);
    expect(result.permissions.canOrder).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it("requires an acknowledgement for the exact current document version", () => {
    const stale = input({ acknowledgements: [{ ...input().acknowledgements[0], documentVersion: "v1" }] });
    const result = evaluateRegulatedEligibility(stale, now);
    expect(result.permissions.canOrder).toBe(false);
    expect(result.reasons).toContain("document_acknowledgement_required");
    const noEvidence = input({ acknowledgements: [{ ...input().acknowledgements[0], evidenceReference: "" }] });
    expect(evaluateRegulatedEligibility(noEvidence, now).reasons).toContain("document_acknowledgement_required");
  });

  it("separates quote, order, hold, and transfer permissions", () => {
    const providerDecision = { ...decision(), permissions: { canQuote: true, canOrder: false, canHold: true, canTransfer: false } };
    const result = evaluateRegulatedEligibility(input({ providerDecision }), now);
    expect(result.permissions).toEqual({ canQuote: true, canOrder: false, canHold: true, canTransfer: false });
    expect(result.decisionReference).toBe("decision-1");
    expect(result.expiresAt).toBe("2026-09-22T12:15:00.000Z");
  });

  it.each([
    ["malformed evaluated-at", (value: EligibilityEvaluationInput) => { value.providerDecision!.evaluatedAt = "invalid"; }, "provider_decision_stale"],
    ["future evaluated-at", (value: EligibilityEvaluationInput) => { value.providerDecision!.evaluatedAt = "2026-09-22T12:01:00.000Z"; }, "provider_decision_stale"],
    ["malformed decision expiry", (value: EligibilityEvaluationInput) => { value.providerDecision!.expiresAt = "invalid"; }, "provider_decision_stale"],
    ["malformed identity expiry", (value: EligibilityEvaluationInput) => { value.providerDecision!.identityVerifiedUntil = "invalid"; }, "identity_stale"],
    ["malformed policy review", (value: EligibilityEvaluationInput) => { value.policy.reviewedAt = "invalid"; }, "country_matrix_stale"],
    ["malformed policy expiry", (value: EligibilityEvaluationInput) => { value.policy.expiresAt = "invalid"; }, "country_matrix_stale"],
    ["malformed document effective date", (value: EligibilityEvaluationInput) => { value.policy.requiredDocuments[0].effectiveAt = "invalid"; }, "document_stale"],
    ["malformed document expiry", (value: EligibilityEvaluationInput) => { value.policy.requiredDocuments[0].expiresAt = "invalid"; }, "document_stale"],
    ["malformed venue expiry", (value: EligibilityEvaluationInput) => { value.providerDecision!.venuePermissions[0].expiresAt = "invalid"; }, "venue_permission_expired"]
  ])("fails closed for %s", (_label, mutate, reason) => {
    const value = input();
    mutate(value);
    const result = evaluateRegulatedEligibility(value, now);
    expect(result.permissions.canOrder).toBe(false);
    expect(result.reasons).toContain(reason);
  });

  it("requires nonempty provider references and exact subject/instrument correlation", () => {
    const missingEvidence = input({ providerDecision: { ...decision(), decisionReference: "", evidenceReference: "" } });
    expect(evaluateRegulatedEligibility(missingEvidence, now).reasons).toContain("provider_evidence_invalid");

    const wrongSubject = input({ providerDecision: { ...decision(), subjectReference: "did:privy:other" } });
    expect(evaluateRegulatedEligibility(wrongSubject, now).reasons).toContain("provider_decision_mismatch");

    const wrongInstrument = input({ providerDecision: { ...decision(), instrumentId: "xstocks:issuer-other" } });
    expect(evaluateRegulatedEligibility(wrongInstrument, now).reasons).toContain("provider_decision_mismatch");
  });
});
