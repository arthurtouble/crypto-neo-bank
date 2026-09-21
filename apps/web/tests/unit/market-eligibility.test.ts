import { describe, expect, it } from "vitest";
import { evaluateProductEligibility, type TokenizedProduct } from "@/lib/markets/eligibility";

const complete: TokenizedProduct = { key: "x", name: "X", category: "treasury", description: "", issuer: "Issuer", venue: "Venue", chainId: 8453, tokenAddress: "0x1111111111111111111111111111111111111111", allowedCountries: ["PT"], blockedCountries: [], documents: [{ label: "Terms", url: "https://example.com/terms" }], reviewedAt: "2026-09-21", enabled: true };

describe("tokenized product eligibility", () => {
  it("fails closed while executable liquidity is unverified", () => expect(evaluateProductEligibility(complete, { countryCode: "PT", identityVerified: true, acceptedDocumentUrls: ["https://example.com/terms"] }).eligible).toBe(false));
  it("rejects missing jurisdiction and identity", () => {
    const result = evaluateProductEligibility(complete, { identityVerified: false, acceptedDocumentUrls: [] });
    expect(result.gates.find((gate) => gate.gate === "jurisdiction")?.passed).toBe(false);
    expect(result.gates.find((gate) => gate.gate === "identity")?.passed).toBe(false);
  });
});
