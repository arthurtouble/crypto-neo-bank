import { describe, expect, it } from "vitest";
import { createXstocksCatalog, XstocksCatalogError, type InstrumentReview } from "@/lib/markets/xstocks";

const baseAddress = "0x1111111111111111111111111111111111111111";
const otherAddress = "0x2222222222222222222222222222222222222222";

function asset(overrides: Record<string, unknown> = {}) {
  return {
    id: "issuer-aapl", name: "Apple xStock", symbol: "AAPLx", isin: "CH0000000001",
    underlyingSymbol: "AAPL", underlyingIsin: "US0378331005",
    underlying: { symbol: "AAPL", isin: "US0378331005", type: "Equity", currency: "USD", listingCountry: "US" },
    description: "Tokenized tracker certificate", logo: "https://example.com/aapl.png", isTradingHalted: false,
    trading: null,
    deployments: [{ address: baseAddress, network: "Base", wrapperAddress: "", wrapperAddressV2: "", supportsAtomicSwaps: false, stablecoins: [] }],
    ...overrides
  };
}

function page(nodes: unknown[], hasNextPage = false) {
  return { nodes, page: { currentPage: 0, hasNextPage } };
}

const currentReview: InstrumentReview = {
  version: "legal-review-1",
  effectiveAt: "2026-09-01T00:00:00.000Z",
  expiresAt: "2027-09-01T00:00:00.000Z",
  issuer: "Backed Assets (JE) Limited",
  legalType: "tracker_certificate",
  rightsSummary: "A tracker certificate providing economic exposure; it is not an ordinary share and does not grant shareholder voting rights.",
  documents: [{ kind: "legal_overview", title: "Product legal overview", url: "https://docs.xstocks.fi/docs/product-legal-overview", version: "2026-09", effectiveAt: "2026-09-01T00:00:00.000Z" }],
  countryPolicy: { allowedCountries: [], blockedCountries: [], provenance: "reviewed_country_matrix_not_connected", reviewedAt: null }
};

function source(payload: unknown): typeof fetch {
  return async () => Response.json(payload);
}

describe("xStocks public instrument catalog", () => {
  it("uses issuer IDs rather than duplicate tickers as instrument identity", async () => {
    const second = asset({ id: "issuer-aapl-secondary", name: "Apple Secondary xStock", deployments: [{ address: otherAddress, network: "Base", wrapperAddress: "", wrapperAddressV2: "", supportsAtomicSwaps: false, stablecoins: [] }] });
    const catalog = createXstocksCatalog({ fetcher: source(page([asset(), second])), review: currentReview, now: () => Date.parse("2026-09-22T12:00:00.000Z") });

    const result = await catalog.search({ query: "AAPLx" });

    expect(result.instruments.map((instrument) => instrument.id)).toEqual(["xstocks:issuer-aapl", "xstocks:issuer-aapl-secondary"]);
    expect(result.instruments.every((instrument) => !("canQuote" in instrument) && !("canOrder" in instrument) && !("canTrade" in instrument))).toBe(true);
  });

  it("fails closed when a deployment network and contract are not a canonical pair", async () => {
    const catalog = createXstocksCatalog({ fetcher: source(page([asset({ deployments: [{ address: "not-an-address", network: "Base", wrapperAddress: "", wrapperAddressV2: "", supportsAtomicSwaps: false, stablecoins: [] }] })])), review: currentReview });
    await expect(catalog.search({ query: "" })).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("marks a stale legal document review without hiding public identity", async () => {
    const review = { ...currentReview, expiresAt: "2026-09-01T00:00:00.000Z" };
    const catalog = createXstocksCatalog({ fetcher: source(page([asset()])), review, now: () => Date.parse("2026-09-22T12:00:00.000Z") });

    const [instrument] = (await catalog.search({ query: "" })).instruments;

    expect(instrument.review).toMatchObject({ version: "legal-review-1", freshness: "stale" });
    expect(instrument.availability).toEqual({ status: "view_only", reason: "legal_review_stale" });
    expect(instrument).not.toHaveProperty("canQuote");
    expect(instrument).not.toHaveProperty("canOrder");
    expect(instrument).not.toHaveProperty("canTrade");
  });

  it("uses the activated corporate-action multiplier for display units", async () => {
    const fetcher: typeof fetch = async (input) => {
      const url = new URL(String(input));
      if (url.pathname.endsWith("/multiplier")) {
        return Response.json({ currentMultiplier: 1, newMultiplier: 2, activationDateTime: Date.parse("2026-09-22T11:00:00.000Z"), reason: "Split" });
      }
      return Response.json(page([asset()]));
    };
    const catalog = createXstocksCatalog({ fetcher, review: currentReview, now: () => Date.parse("2026-09-22T12:00:00.000Z") });

    const instrument = await catalog.resolve("xstocks:issuer-aapl");

    expect(instrument?.corporateAction).toMatchObject({ model: "rebasing_multiplier", activeMultiplier: 2, pendingMultiplier: null, reason: "Split" });
    expect(instrument?.corporateAction.displayAmountFormula).toBe("raw amount × active multiplier");
  });

  it("does not serve an expired snapshot when the public source is unavailable", async () => {
    const catalog = createXstocksCatalog({ fetcher: async () => { throw new Error("offline"); }, review: currentReview });
    await expect(catalog.search({ query: "" })).rejects.toBeInstanceOf(XstocksCatalogError);
    await expect(catalog.search({ query: "" })).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("rejects unsupported public product categories", async () => {
    const unsupported = asset({ underlying: { symbol: "BOND", isin: "US0000000001", type: "Bond", currency: "USD", listingCountry: "US" } });
    const catalog = createXstocksCatalog({ fetcher: source(page([unsupported])), review: currentReview });
    await expect(catalog.search({ query: "" })).rejects.toMatchObject({ code: "provider_invalid" });
  });

  it("does not depend on deprecated ticker-join fields", async () => {
    const current = asset();
    delete (current as Partial<typeof current>).underlyingSymbol;
    delete (current as Partial<typeof current>).underlyingIsin;
    const catalog = createXstocksCatalog({ fetcher: source(page([current])), review: currentReview });
    expect((await catalog.search({ query: "AAPL" })).instruments).toHaveLength(1);
  });

  it("never treats public legal metadata as a completed Aurel legal review", async () => {
    const catalog = createXstocksCatalog({ fetcher: source(page([asset()])), now: () => Date.parse("2026-09-22T12:00:00.000Z") });
    const [instrument] = (await catalog.search({ query: "AAPL" })).instruments;
    expect(instrument.review.freshness).toBe("stale");
    expect(instrument.availability).toEqual({ status: "view_only", reason: "legal_review_stale" });
    expect(instrument.countryPolicy.customerEligibility).toBe("not_evaluated");
  });
});
