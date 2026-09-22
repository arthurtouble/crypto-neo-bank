import { getAddress } from "viem";
import { z } from "zod";
import {
  instrumentCatalogQuerySchema, publicInstrumentSchema, type InstrumentCatalogPage, type PublicInstrument
} from "@/lib/markets/instruments";

const API = "https://api.xstocks.fi/api/v2";
const CACHE_TTL_MS = 300_000;
const MAX_RESPONSE_BYTES = 1_000_000;
const MAX_SOURCE_PAGES = 5;
const PAGE_SIZE = 30;

const networkIdentity: Record<string, { namespace: "eip155" | "solana" | "tron" | "ton"; chainId: number | null }> = {
  Ethereum: { namespace: "eip155", chainId: 1 }, Polygon: { namespace: "eip155", chainId: 137 },
  Gnosis: { namespace: "eip155", chainId: 100 }, BinanceSmartChain: { namespace: "eip155", chainId: 56 },
  Arbitrum: { namespace: "eip155", chainId: 42161 }, Avalanche: { namespace: "eip155", chainId: 43114 },
  Fantom: { namespace: "eip155", chainId: 250 }, Base: { namespace: "eip155", chainId: 8453 },
  Lisk: { namespace: "eip155", chainId: 1135 }, Etherlink: { namespace: "eip155", chainId: 42793 },
  Sonic: { namespace: "eip155", chainId: 146 }, Mantle: { namespace: "eip155", chainId: 5000 },
  HyperEVM: { namespace: "eip155", chainId: 999 }, Ink: { namespace: "eip155", chainId: 57073 },
  XLayer: { namespace: "eip155", chainId: 196 }, Optimism: { namespace: "eip155", chainId: 10 },
  Solana: { namespace: "solana", chainId: null }, Tron: { namespace: "tron", chainId: null }, Ton: { namespace: "ton", chainId: null }
};

const deploymentSchema = z.object({
  address: z.string().min(1).max(128), network: z.string().min(1).max(40),
  wrapperAddress: z.string().nullish(), wrapperAddressV2: z.string().nullish(),
  supportsAtomicSwaps: z.boolean().default(false), stablecoins: z.array(z.unknown()).default([])
}).passthrough();
const assetSchema = z.object({
  id: z.string().min(1).max(160), name: z.string().min(1).max(200), symbol: z.string().min(1).max(32),
  isin: z.string(), underlyingSymbol: z.string().optional(), underlyingIsin: z.string().optional(),
  underlying: z.object({
    symbol: z.string().min(1).max(32), isin: z.string().nullable(), type: z.enum(["Equity", "ETF"]),
    currency: z.enum(["USD", "CHF", "EUR", "HKD", "GBP", "GBX", "CNY"]),
    listingCountry: z.string().regex(/^[A-Z]{2}$/).nullable()
  }),
  description: z.string().max(4_000), logo: z.string(), isTradingHalted: z.boolean(), trading: z.unknown().nullable(),
  deployments: z.array(deploymentSchema).min(1).max(24)
}).passthrough();
const sourcePageSchema = z.object({
  nodes: z.array(assetSchema).max(100),
  page: z.object({ currentPage: z.number().int().nonnegative(), hasNextPage: z.boolean() })
});
const multiplierSchema = z.object({
  currentMultiplier: z.number().positive(), newMultiplier: z.number().positive(),
  activationDateTime: z.number().nonnegative(),
  reason: z.enum(["FeeAccrual", "Dividend", "Split", "ReverseSplit", "Administrative"]).nullable()
});

export type InstrumentReview = {
  version: string;
  effectiveAt: string;
  expiresAt: string;
  issuer: string;
  legalType: "tracker_certificate";
  rightsSummary: string;
  documents: Array<{ kind: "legal_overview" | "prospectus" | "final_terms"; title: string; url: string; version: string; effectiveAt: string }>;
  countryPolicy: { allowedCountries: string[]; blockedCountries: string[]; provenance: "reviewed_country_matrix_not_connected"; reviewedAt: string | null };
};

const defaultReview: InstrumentReview = {
  // Public documentation is not an Aurel jurisdiction or instrument review.
  // A dated review must be injected only after the legal approval workflow.
  version: "public-source-unreviewed", effectiveAt: "1970-01-01T00:00:00.000Z", expiresAt: "1970-01-01T00:00:00.000Z",
  issuer: "Backed Assets (JE) Limited", legalType: "tracker_certificate",
  rightsSummary: "A tracker certificate providing economic exposure to an underlying security; it is not an ordinary share and does not grant shareholder voting rights.",
  documents: [{ kind: "legal_overview", title: "xStocks product legal overview", url: "https://docs.xstocks.fi/docs/product-legal-overview", version: "public-source-unreviewed", effectiveAt: "1970-01-01T00:00:00.000Z" }],
  countryPolicy: { allowedCountries: [], blockedCountries: [], provenance: "reviewed_country_matrix_not_connected", reviewedAt: null }
};

type Snapshot = { version: string; observedAt: string; expiresAtMs: number; instruments: PublicInstrument[] };
export type XstocksCatalogCache = { snapshot?: Snapshot };
type Dependencies = { fetcher?: typeof fetch; now?: () => number; review?: InstrumentReview; cache?: XstocksCatalogCache };

export class XstocksCatalogError extends Error {
  constructor(public readonly code: "provider_unavailable" | "provider_invalid" | "invalid_cursor" | "stale_cursor") { super(code); }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  const declared = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !Number.isFinite(declared) || declared < 0 || declared > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new XstocksCatalogError(response.ok ? "provider_invalid" : "provider_unavailable");
  }
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) { await reader.cancel(); throw new Error("oversized"); }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new XstocksCatalogError("provider_invalid");
  }
}

function canonicalDeployment(value: z.infer<typeof deploymentSchema>) {
  const identity = networkIdentity[value.network];
  if (!identity) throw new XstocksCatalogError("provider_invalid");
  let address = value.address;
  let wrapper = value.wrapperAddressV2 || value.wrapperAddress || null;
  if (identity.namespace === "eip155") {
    try {
      address = getAddress(address).toLowerCase();
      wrapper = wrapper ? getAddress(wrapper).toLowerCase() : null;
    } catch { throw new XstocksCatalogError("provider_invalid"); }
  } else if (!/^[A-Za-z0-9:_-]{20,128}$/.test(address)) {
    throw new XstocksCatalogError("provider_invalid");
  }
  return {
    network: value.network, namespace: identity.namespace, chainId: identity.chainId, tokenAddress: address,
    canonicalId: identity.chainId === null ? `${identity.namespace}:${address}` : `eip155:${identity.chainId}:${address}`,
    wrapperAddress: wrapper, supportsAtomicSwaps: value.supportsAtomicSwaps
  };
}

function normalizeAsset(value: z.infer<typeof assetSchema>, now: number, review: InstrumentReview): PublicInstrument {
  const observedAt = new Date(now).toISOString();
  const reviewFreshness = Date.parse(review.effectiveAt) <= now && Date.parse(review.expiresAt) > now ? "current" : "stale";
  return publicInstrumentSchema.parse({
    schemaVersion: 1, id: `xstocks:${value.id}`, source: { adapter: "xstocks_public", issuerInstrumentId: value.id, observedAt, expiresAt: new Date(now + CACHE_TTL_MS).toISOString() },
    issuer: review.issuer, symbol: value.symbol, name: value.name, description: value.description,
    logoUrl: /^https:\/\//i.test(value.logo) ? value.logo : null, legalType: review.legalType, rightsSummary: review.rightsSummary,
    underlying: { category: value.underlying.type === "Equity" ? "equity" : "etf", symbol: value.underlying.symbol, isin: value.underlying.isin, currency: value.underlying.currency, listingCountry: value.underlying.listingCountry },
    deployments: value.deployments.map(canonicalDeployment),
    countryPolicy: { ...review.countryPolicy, customerEligibility: "not_evaluated" }, documents: review.documents,
    review: { version: review.version, effectiveAt: review.effectiveAt, expiresAt: review.expiresAt, freshness: reviewFreshness },
    corporateAction: { model: "rebasing_multiplier", authority: "xstocks_public_multiplier", displayAmountFormula: "raw amount × active multiplier", activeMultiplier: null, pendingMultiplier: null, activationAt: null, reason: null, observedAt: null },
    pricing: { authority: "xstocks_public_price_data", indicativeOnly: true },
    availability: { status: "view_only", reason: reviewFreshness === "current" ? "partner_not_connected" : "legal_review_stale" }
  });
}

function encodeCursor(value: object): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string): { version: string; query: string; offset: number } {
  try {
    const normalized = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
    const binary = atob(normalized);
    const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
    return z.object({ version: z.string().uuid(), query: z.string().max(120), offset: z.number().int().positive() }).parse(JSON.parse(new TextDecoder().decode(bytes)));
  } catch { throw new XstocksCatalogError("invalid_cursor"); }
}

class XstocksCatalog {
  private readonly fetcher: typeof fetch;
  private readonly now: () => number;
  private readonly review: InstrumentReview;
  private readonly cache: XstocksCatalogCache;

  constructor(dependencies: Dependencies) {
    this.fetcher = dependencies.fetcher ?? fetch;
    this.now = dependencies.now ?? Date.now;
    this.review = dependencies.review ?? defaultReview;
    this.cache = dependencies.cache ?? {};
  }

  private async snapshot(): Promise<Snapshot> {
    const now = this.now();
    if (this.cache.snapshot && this.cache.snapshot.expiresAtMs > now) return this.cache.snapshot;
    const assets: z.infer<typeof assetSchema>[] = [];
    try {
      for (let page = 0; page < MAX_SOURCE_PAGES; page++) {
        const query = new URLSearchParams({ page: String(page), pageSize: "100" });
        const response = await this.fetcher(`${API}/public/assets?${query}`, { headers: { Accept: "application/json", "User-Agent": "Aurel/1.0 public-instrument-catalog" }, signal: AbortSignal.timeout(12_000) });
        const parsed = sourcePageSchema.safeParse(await readBoundedJson(response));
        if (!parsed.success || parsed.data.page.currentPage !== page) throw new XstocksCatalogError("provider_invalid");
        assets.push(...parsed.data.nodes);
        if (!parsed.data.page.hasNextPage) break;
        if (page === MAX_SOURCE_PAGES - 1) throw new XstocksCatalogError("provider_invalid");
      }
    } catch (error) {
      if (error instanceof XstocksCatalogError) throw error;
      throw new XstocksCatalogError("provider_unavailable");
    }
    const instruments = assets.map((asset) => normalizeAsset(asset, now, this.review));
    const ids = new Set<string>();
    const deployments = new Set<string>();
    for (const instrument of instruments) {
      if (ids.has(instrument.id)) throw new XstocksCatalogError("provider_invalid");
      ids.add(instrument.id);
      for (const deployment of instrument.deployments) {
        if (deployments.has(deployment.canonicalId)) throw new XstocksCatalogError("provider_invalid");
        deployments.add(deployment.canonicalId);
      }
    }
    const snapshot = { version: crypto.randomUUID(), observedAt: new Date(now).toISOString(), expiresAtMs: now + CACHE_TTL_MS, instruments };
    this.cache.snapshot = snapshot;
    return snapshot;
  }

  async search(input: { query?: string; cursor?: string }): Promise<InstrumentCatalogPage> {
    const parsed = instrumentCatalogQuerySchema.parse(input);
    const snapshot = await this.snapshot();
    const query = parsed.query.toLocaleLowerCase("en-US");
    const cursor = parsed.cursor ? decodeCursor(parsed.cursor) : null;
    if (cursor && cursor.version !== snapshot.version) throw new XstocksCatalogError("stale_cursor");
    if (cursor && cursor.query !== query) throw new XstocksCatalogError("invalid_cursor");
    const matches = snapshot.instruments.filter((instrument) => !query || [instrument.symbol, instrument.name, instrument.source.issuerInstrumentId, instrument.underlying.symbol, instrument.underlying.isin ?? ""].some((value) => value.toLocaleLowerCase("en-US").includes(query)));
    const offset = cursor?.offset ?? 0;
    const instruments = matches.slice(offset, offset + PAGE_SIZE);
    const nextOffset = offset + instruments.length;
    return { instruments, nextCursor: nextOffset < matches.length ? encodeCursor({ version: snapshot.version, query, offset: nextOffset }) : null, observedAt: snapshot.observedAt, expiresAt: new Date(snapshot.expiresAtMs).toISOString(), source: "xstocks_public" };
  }

  async resolve(id: string): Promise<PublicInstrument | null> {
    const snapshot = await this.snapshot();
    const instrument = snapshot.instruments.find((item) => item.id === id);
    if (!instrument) return null;
    const deployment = instrument.deployments[0];
    const query = new URLSearchParams({ network: deployment.network });
    let payload: unknown;
    try {
      const response = await this.fetcher(`${API}/public/assets/${encodeURIComponent(instrument.symbol)}/multiplier?${query}`, { headers: { Accept: "application/json", "User-Agent": "Aurel/1.0 public-instrument-catalog" }, signal: AbortSignal.timeout(12_000) });
      payload = await readBoundedJson(response);
    } catch (error) {
      if (error instanceof XstocksCatalogError) throw error;
      throw new XstocksCatalogError("provider_unavailable");
    }
    const multiplier = multiplierSchema.safeParse(payload);
    if (!multiplier.success) throw new XstocksCatalogError("provider_invalid");
    const rawActivation = multiplier.data.activationDateTime;
    const activationMs = rawActivation < 1_000_000_000_000 ? rawActivation * 1_000 : rawActivation;
    const activated = activationMs <= this.now();
    return publicInstrumentSchema.parse({ ...instrument, corporateAction: {
      ...instrument.corporateAction,
      activeMultiplier: activated ? multiplier.data.newMultiplier : multiplier.data.currentMultiplier,
      pendingMultiplier: activated ? null : multiplier.data.newMultiplier,
      activationAt: new Date(activationMs).toISOString(), reason: multiplier.data.reason,
      observedAt: new Date(this.now()).toISOString()
    } });
  }
}

const sharedCatalog = new XstocksCatalog({ cache: {} });

export function createXstocksCatalog(dependencies: Dependencies = {}) { return new XstocksCatalog(dependencies); }
export function getXstocksCatalogPage(input: { query?: string; cursor?: string }) { return sharedCatalog.search(input); }
export function getXstocksInstrument(id: string) { return sharedCatalog.resolve(id); }
