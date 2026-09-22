import { z } from "zod";

export const instrumentDocumentSchema = z.object({
  kind: z.enum(["legal_overview", "prospectus", "final_terms"]),
  title: z.string().min(1).max(160),
  url: z.string().url(),
  version: z.string().min(1).max(80),
  effectiveAt: z.string().datetime()
});

export const tokenDeploymentSchema = z.object({
  network: z.string().min(1).max(40),
  namespace: z.enum(["eip155", "solana", "tron", "ton"]),
  chainId: z.number().int().positive().nullable(),
  tokenAddress: z.string().min(1).max(128),
  canonicalId: z.string().min(1).max(180),
  wrapperAddress: z.string().min(1).max(128).nullable(),
  supportsAtomicSwaps: z.boolean()
});

export const publicInstrumentSchema = z.object({
  schemaVersion: z.literal(1),
  id: z.string().regex(/^xstocks:[A-Za-z0-9._:-]{1,160}$/),
  source: z.object({
    adapter: z.literal("xstocks_public"),
    issuerInstrumentId: z.string().min(1).max(160),
    observedAt: z.string().datetime(),
    expiresAt: z.string().datetime()
  }),
  issuer: z.string().min(1).max(160),
  symbol: z.string().min(1).max(32),
  name: z.string().min(1).max(200),
  description: z.string().max(4_000),
  logoUrl: z.string().url().nullable(),
  legalType: z.literal("tracker_certificate"),
  rightsSummary: z.string().min(1).max(1_000),
  underlying: z.object({
    category: z.enum(["equity", "etf"]),
    symbol: z.string().min(1).max(32),
    isin: z.string().min(1).max(32).nullable(),
    currency: z.enum(["USD", "CHF", "EUR", "HKD", "GBP", "GBX", "CNY"]),
    listingCountry: z.string().regex(/^[A-Z]{2}$/).nullable()
  }),
  deployments: z.array(tokenDeploymentSchema).min(1).max(24),
  countryPolicy: z.object({
    allowedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)),
    blockedCountries: z.array(z.string().regex(/^[A-Z]{2}$/)),
    provenance: z.literal("reviewed_country_matrix_not_connected"),
    reviewedAt: z.string().datetime().nullable(),
    customerEligibility: z.literal("not_evaluated")
  }),
  documents: z.array(instrumentDocumentSchema).max(20),
  review: z.object({
    version: z.string().min(1).max(80),
    effectiveAt: z.string().datetime(),
    expiresAt: z.string().datetime(),
    freshness: z.enum(["current", "stale"])
  }),
  corporateAction: z.object({
    model: z.literal("rebasing_multiplier"),
    authority: z.literal("xstocks_public_multiplier"),
    displayAmountFormula: z.literal("raw amount × active multiplier"),
    activeMultiplier: z.number().positive().nullable(),
    pendingMultiplier: z.number().positive().nullable(),
    activationAt: z.string().datetime().nullable(),
    reason: z.enum(["FeeAccrual", "Dividend", "Split", "ReverseSplit", "Administrative"]).nullable(),
    observedAt: z.string().datetime().nullable()
  }),
  pricing: z.object({
    authority: z.literal("xstocks_public_price_data"),
    indicativeOnly: z.literal(true)
  }),
  availability: z.object({
    status: z.literal("view_only"),
    reason: z.enum(["partner_not_connected", "legal_review_stale"])
  })
});

export type PublicInstrument = z.infer<typeof publicInstrumentSchema>;

export const instrumentCatalogQuerySchema = z.object({
  query: z.string().trim().max(120).default(""),
  cursor: z.string().regex(/^[A-Za-z0-9_-]{1,2000}$/).optional()
});

export type InstrumentCatalogPage = {
  instruments: PublicInstrument[];
  nextCursor: string | null;
  observedAt: string;
  expiresAt: string;
  source: "xstocks_public";
};
