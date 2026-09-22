export type MarketCategory = "treasury" | "public_equity" | "private_market";
export type ProductGate = "issuer" | "venue" | "jurisdiction" | "identity" | "documents" | "liquidity";

export type TokenizedProduct = {
  key: string;
  name: string;
  category: MarketCategory;
  description: string;
  issuer?: string;
  venue?: string;
  chainId?: number;
  tokenAddress?: string;
  allowedCountries: string[];
  blockedCountries: string[];
  documents: Array<{ label: string; url: string }>;
  reviewedAt?: string;
  enabled: boolean;
};

export type EligibilityContext = { countryCode?: string; identityVerified: boolean; acceptedDocumentUrls: string[] };
export type EligibilityResult = { eligible: boolean; gates: Array<{ gate: ProductGate; passed: boolean; reason: string }> };

export function evaluateProductEligibility(product: TokenizedProduct, context: EligibilityContext): EligibilityResult {
  const country = context.countryCode?.toUpperCase();
  const jurisdictionPassed = Boolean(country) && !product.blockedCountries.includes(country!) && (product.allowedCountries.length === 0 || product.allowedCountries.includes(country!));
  const gates: EligibilityResult["gates"] = [
    { gate: "issuer", passed: Boolean(product.issuer), reason: product.issuer ? "Issuer recorded" : "Issuer due diligence is incomplete" },
    { gate: "venue", passed: Boolean(product.venue), reason: product.venue ? "Execution venue recorded" : "No approved execution venue" },
    { gate: "jurisdiction", passed: jurisdictionPassed, reason: jurisdictionPassed ? "Country is within the approved distribution scope" : "Country eligibility is not established" },
    { gate: "identity", passed: context.identityVerified, reason: context.identityVerified ? "Required identity state is present" : "Regulated identity review is required" },
    { gate: "documents", passed: product.documents.length > 0 && product.documents.every((document) => context.acceptedDocumentUrls.includes(document.url)), reason: "Current offering documents must be reviewed and accepted" },
    { gate: "liquidity", passed: false, reason: "Executable liquidity must be checked immediately before an order" }
  ];
  return { eligible: product.enabled && gates.every((gate) => gate.passed), gates };
}

export const marketCapabilities: TokenizedProduct[] = [
  { key: "treasury", name: "Tokenized treasuries", category: "treasury", description: "Issuer-backed short-duration government security exposure, subject to transfer restrictions and offering documents.", allowedCountries: [], blockedCountries: [], documents: [], enabled: false },
  { key: "equities", name: "Tokenized public equities", category: "public_equity", description: "Economic or direct security interests require an approved issuer, venue, distribution analysis, and market-data rights.", allowedCountries: [], blockedCountries: [], documents: [], enabled: false },
  { key: "private", name: "Private markets", category: "private_market", description: "Permissioned interests for appropriately verified and eligible clients only.", allowedCountries: [], blockedCountries: [], documents: [], enabled: false }
];

export type RegulatedPermissions = { canQuote: boolean; canOrder: boolean; canHold: boolean; canTransfer: boolean };
export type EligibilityReason = "partner_not_connected" | "provider_unavailable" | "provider_decision_mismatch" | "provider_decision_stale"
  | "provider_denied" | "provider_evidence_invalid" | "identity_stale" | "customer_class_unknown" | "country_unknown" | "country_restricted" | "country_matrix_stale"
  | "asset_restricted" | "document_stale" | "document_acknowledgement_required" | "venue_not_approved" | "venue_permission_expired";

export type ProviderEligibilityDecision = {
  provider: string;
  decisionReference: string;
  evidenceReference: string;
  ruleVersion: string;
  subjectReference: string;
  instrumentId: string;
  status: "eligible" | "ineligible" | "review_required" | "unavailable";
  reasonCode?: "partner_not_connected";
  residencyCountry: string | null;
  nationalityCountries: string[];
  customerClass: string | null;
  identityVerifiedUntil: string | null;
  permissions: RegulatedPermissions;
  restrictedInstrumentIds: string[];
  venuePermissions: Array<{ venue: string; status: "active" | "inactive"; expiresAt: string }>;
  evaluatedAt: string;
  expiresAt: string;
};

export type InstrumentEligibilityPolicy = {
  instrumentId: string;
  allowedCountries: string[];
  blockedCountries: string[];
  provenance: string;
  reviewedAt: string | null;
  expiresAt: string;
  venue: string | null;
  requiredDocuments: Array<{ key: string; version: string; effectiveAt: string; expiresAt: string }>;
};

export type DocumentAcknowledgement = {
  subjectReference: string;
  documentKey: string;
  documentVersion: string;
  acceptedAt: string;
  evidenceReference: string;
};

export type EligibilityEvaluationInput = {
  subjectReference: string;
  instrumentId: string;
  now: number;
  policy: InstrumentEligibilityPolicy;
  providerDecision: ProviderEligibilityDecision | null;
  acknowledgements: DocumentAcknowledgement[];
};

export type RegulatedEligibilityResult = {
  subjectReference: string;
  instrumentId: string;
  permissions: RegulatedPermissions;
  reasons: EligibilityReason[];
  ruleVersion: string | null;
  decisionReference: string | null;
  evidenceReference: string | null;
  evaluatedAt: string;
  expiresAt: string | null;
};

const noPermissions = (): RegulatedPermissions => ({ canQuote: false, canOrder: false, canHold: false, canTransfer: false });
const parsedTime = (value: string | null): number | null => {
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function evaluateRegulatedEligibility(input: EligibilityEvaluationInput, at = input.now): RegulatedEligibilityResult {
  const decision = input.providerDecision;
  const reasons = new Set<EligibilityReason>();
  if (!decision) reasons.add("provider_unavailable");
  else if (decision.status === "unavailable" && decision.reasonCode === "partner_not_connected") reasons.add("partner_not_connected");
  else {
    if (decision.subjectReference !== input.subjectReference || decision.instrumentId !== input.instrumentId || input.policy.instrumentId !== input.instrumentId) reasons.add("provider_decision_mismatch");
    const decisionEvaluatedAt = parsedTime(decision.evaluatedAt);
    const decisionExpiresAt = parsedTime(decision.expiresAt);
    if (decisionEvaluatedAt === null || decisionExpiresAt === null || decisionEvaluatedAt > at || decisionExpiresAt <= at || decisionEvaluatedAt >= decisionExpiresAt) reasons.add("provider_decision_stale");
    if (!decision.provider.trim() || !decision.decisionReference.trim() || !decision.evidenceReference.trim() || !decision.ruleVersion.trim()) reasons.add("provider_evidence_invalid");
    if (decision.status !== "eligible") reasons.add("provider_denied");
    const identityVerifiedUntil = parsedTime(decision.identityVerifiedUntil);
    if (identityVerifiedUntil === null || identityVerifiedUntil <= at) reasons.add("identity_stale");
    if (!decision.customerClass?.trim()) reasons.add("customer_class_unknown");
    const countries = [decision.residencyCountry, ...decision.nationalityCountries].filter((value): value is string => Boolean(value)).map((value) => value.toUpperCase());
    if (!decision.residencyCountry || decision.nationalityCountries.length === 0 || countries.some((country) => !/^[A-Z]{2}$/.test(country))) reasons.add("country_unknown");
    const policyReviewedAt = parsedTime(input.policy.reviewedAt);
    const policyExpiresAt = parsedTime(input.policy.expiresAt);
    if (!input.policy.provenance.trim() || policyReviewedAt === null || policyExpiresAt === null || policyReviewedAt > at || policyExpiresAt <= at || policyReviewedAt >= policyExpiresAt || input.policy.allowedCountries.length === 0) reasons.add("country_matrix_stale");
    if (countries.some((country) => input.policy.blockedCountries.includes(country) || input.policy.allowedCountries.length > 0 && !input.policy.allowedCountries.includes(country))) reasons.add("country_restricted");
    if (decision.restrictedInstrumentIds.includes(input.instrumentId)) reasons.add("asset_restricted");
    for (const document of input.policy.requiredDocuments) {
      const documentEffectiveAt = parsedTime(document.effectiveAt);
      const documentExpiresAt = parsedTime(document.expiresAt);
      if (documentEffectiveAt === null || documentExpiresAt === null || documentEffectiveAt > at || documentExpiresAt <= at || documentEffectiveAt >= documentExpiresAt) reasons.add("document_stale");
      if (!input.acknowledgements.some((acknowledgement) => acknowledgement.subjectReference === input.subjectReference
        && acknowledgement.documentKey === document.key && acknowledgement.documentVersion === document.version
        && acknowledgement.evidenceReference.trim().length > 0
        && parsedTime(acknowledgement.acceptedAt) !== null && documentEffectiveAt !== null
        && parsedTime(acknowledgement.acceptedAt)! >= documentEffectiveAt)) reasons.add("document_acknowledgement_required");
    }
  }

  let permissions = noPermissions();
  if (decision && reasons.size === 0) {
    permissions = { ...decision.permissions };
    const venue = input.policy.venue;
    const venuePermission = venue ? decision.venuePermissions.find((permission) => permission.venue === venue && permission.status === "active") : undefined;
    if (!venue) reasons.add("venue_not_approved");
    else if (!venuePermission || parsedTime(venuePermission.expiresAt) === null || parsedTime(venuePermission.expiresAt)! <= at) reasons.add("venue_permission_expired");
    if (reasons.has("venue_not_approved") || reasons.has("venue_permission_expired")) {
      permissions.canQuote = false;
      permissions.canOrder = false;
    }
  }
  return {
    subjectReference: input.subjectReference, instrumentId: input.instrumentId, permissions, reasons: [...reasons],
    ruleVersion: decision?.ruleVersion ?? null, decisionReference: decision?.decisionReference || null,
    evidenceReference: decision?.evidenceReference || null, evaluatedAt: new Date(at).toISOString(),
    expiresAt: decision?.expiresAt ?? null
  };
}
