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
