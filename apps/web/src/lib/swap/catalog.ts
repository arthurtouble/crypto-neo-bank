import { z } from "zod";
import { assetId, catalogAssetSchema, parseAssetId, type AssetId, type CatalogAsset } from "@/lib/swap/assets";
import { CATALOG_REGISTRY, type CatalogRegistry } from "@/lib/swap/catalog-registry";

const TTL_MS = 300_000;
const PAGE_SIZE = 30;
const MAX_TOKENS_PER_CHAIN = 50_000;
const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_CACHE_BYTES = 8_000_000;
const NATIVE_ADDRESSES = new Set(["0x0000000000000000000000000000000000000000", "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee"]);
const REVIEWED_BASE_ASSETS: readonly CatalogAsset[] = [
  { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", chainId: 8453,
    address: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", symbol: "USDC", name: "USD Coin",
    decimals: 6, logoUrl: null, verification: "verified", eligibility: "eligible" },
  { id: "8453:0x4200000000000000000000000000000000000006", chainId: 8453,
    address: "0x4200000000000000000000000000000000000006", symbol: "WETH", name: "Wrapped Ether",
    decimals: 18, logoUrl: null, verification: "verified", eligibility: "eligible" }
];
const tokenSchema = z.object({
  address: z.string(),
  symbol: z.string().trim().min(1).max(32),
  name: z.string().trim().min(1).max(120),
  decimals: z.number().int().min(0).max(36),
  chainId: z.number().int(),
  logoURI: z.string().optional().nullable()
});

type Snapshot = { version: string; observedAt: string; expiresAt: number; assets: CatalogAsset[] };
type Dependencies = { fetcher?: typeof fetch; now?: () => number; registry?: CatalogRegistry; cache?: CatalogCache };
type SortKey = { rank: number; popular: number; verified: number; symbol: string; chainId: number; id: string };
type Cursor = { versions: string; query: string; chains: number[]; after: SortKey };

export class CatalogCache {
  private entries = new Map<number, { json: string; bytes: number; version: string; expiresAt: number }>();
  private totalBytes = 0;

  constructor(readonly maxBytes = MAX_CACHE_BYTES) {}

  get sizeBytes() { return this.totalBytes; }

  get(chainId: number, now: number): Snapshot | null {
    const entry = this.entries.get(chainId);
    if (!entry) return null;
    if (entry.expiresAt <= now) { this.remove(chainId); return null; }
    this.entries.delete(chainId);
    this.entries.set(chainId, entry);
    return JSON.parse(entry.json) as Snapshot;
  }

  hasVersion(chainId: number, version: string, now: number): boolean {
    const entry = this.entries.get(chainId);
    return Boolean(entry && entry.expiresAt > now && entry.version === version);
  }

  put(chainId: number, snapshot: Snapshot): void {
    const json = JSON.stringify(snapshot);
    const bytes = new TextEncoder().encode(json).byteLength;
    if (bytes > this.maxBytes) throw new CatalogUnavailableError("capacity_exceeded");
    this.remove(chainId);
    while (this.totalBytes + bytes > this.maxBytes) {
      const oldest = this.entries.keys().next().value;
      if (oldest === undefined) throw new CatalogUnavailableError("capacity_exceeded");
      this.remove(oldest);
    }
    this.entries.set(chainId, { json, bytes, version: snapshot.version, expiresAt: snapshot.expiresAt });
    this.totalBytes += bytes;
  }

  private remove(chainId: number): void {
    const entry = this.entries.get(chainId);
    if (entry) { this.totalBytes -= entry.bytes; this.entries.delete(chainId); }
  }
}

export function createCatalogCache(maxBytes = MAX_CACHE_BYTES): CatalogCache {
  return new CatalogCache(maxBytes);
}

// Only serialized public metadata lives across requests. Fetch responses and promises do not.
const defaultCache = createCatalogCache();

export class CatalogUnavailableError extends Error {
  constructor(readonly code: "provider_unavailable" | "provider_unreachable" | "stale_cursor" | "invalid_cursor" | "capacity_exceeded") {
    super(code === "provider_unavailable" || code === "provider_unreachable" || code === "capacity_exceeded"
      ? "The live asset catalog is unavailable."
      : "The asset search changed. Search again.");
    this.name = "CatalogUnavailableError";
  }
}

export function screenAsset(asset: Pick<CatalogAsset, "id">, registry: CatalogRegistry = CATALOG_REGISTRY): "denied" | "verified" | "unverified" | "regulated" {
  if (registry.denied.has(asset.id)) return "denied";
  if (registry.regulated.has(asset.id)) return "regulated";
  return registry.verified.has(asset.id) ? "verified" : "unverified";
}

function normalizeToken(value: unknown, chainId: number): CatalogAsset | null {
  const parsed = tokenSchema.safeParse(value);
  if (!parsed.success || parsed.data.chainId !== chainId) return null;
  const token = parsed.data;
  const address = NATIVE_ADDRESSES.has(token.address.toLowerCase()) ? null : token.address;
  let id: AssetId;
  try { id = assetId(chainId, address); } catch { return null; }
  const logoUrl = token.logoURI && /^https:\/\//i.test(token.logoURI) ? token.logoURI : null;
  const candidate = {
    id, chainId, address: address === null ? null : address.toLowerCase(),
    symbol: token.symbol, name: token.name, decimals: token.decimals, logoUrl,
    verification: "unverified" as const, eligibility: "eligible" as const
  };
  const validated = catalogAssetSchema.safeParse(candidate);
  return validated.success ? validated.data : null;
}

async function fetchSnapshot(chainId: number, fetcher: typeof fetch, now: number): Promise<Snapshot> {
  const query = new URLSearchParams({ chains: String(chainId), chainTypes: "EVM", minPriceUSD: "0" });
  let response: Response;
  try {
    response = await fetcher(`https://li.quest/v1/tokens?${query}`, {
      headers: process.env.LIFI_API_KEY ? { "x-lifi-api-key": process.env.LIFI_API_KEY } : undefined,
      signal: AbortSignal.timeout(12_000)
    });
  } catch { throw new CatalogUnavailableError("provider_unreachable"); }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (!response.ok || !Number.isFinite(declaredLength) || declaredLength > MAX_RESPONSE_BYTES || !response.body) {
    await response.body?.cancel().catch(() => undefined);
    throw new CatalogUnavailableError("provider_unavailable");
  }
  let payload: unknown;
  const reader = response.body.getReader();
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new Error("oversized");
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
    payload = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes)) as unknown;
  } catch { throw new CatalogUnavailableError("provider_unavailable"); }
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) throw new CatalogUnavailableError("provider_unavailable");
  const envelope = payload as Record<string, unknown>;
  const tokens = envelope.tokens && typeof envelope.tokens === "object" && !Array.isArray(envelope.tokens) ? envelope.tokens as Record<string, unknown> : envelope;
  const rows = tokens[String(chainId)];
  if (!Array.isArray(rows) || rows.length > MAX_TOKENS_PER_CHAIN) throw new CatalogUnavailableError("provider_unavailable");
  const unique = new Map<AssetId, CatalogAsset>();
  const conflicting = new Set<AssetId>();
  for (const row of rows) {
    const item = normalizeToken(row, chainId);
    if (!item || conflicting.has(item.id)) continue;
    const existing = unique.get(item.id);
    if (existing && existing.decimals !== item.decimals) { unique.delete(item.id); conflicting.add(item.id); }
    else if (!existing) unique.set(item.id, item);
  }
  return { version: crypto.randomUUID(), observedAt: new Date(now).toISOString(), expiresAt: now + TTL_MS, assets: [...unique.values()] };
}

async function snapshot(chainId: number, fetcher: typeof fetch, cache: CatalogCache, now: number, cursorMode: boolean): Promise<Snapshot> {
  const saved = cache.get(chainId, now);
  if (saved) return saved;
  if (cursorMode) throw new CatalogUnavailableError("stale_cursor");
  const fresh = await fetchSnapshot(chainId, fetcher, now);
  const concurrent = cache.get(chainId, now);
  if (concurrent) return concurrent;
  cache.put(chainId, fresh);
  return fresh;
}

function parseCursor(value: string): Cursor {
  if (value.length > 2_000 || !/^[A-Za-z0-9_-]+$/.test(value)) throw new CatalogUnavailableError("invalid_cursor");
  try {
    const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
    const decoded = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(binary, (character) => character.charCodeAt(0)))) as Cursor;
    const after = decoded.after;
    if (typeof decoded.versions !== "string" || typeof decoded.query !== "string" || !Array.isArray(decoded.chains)
      || !after || !Number.isSafeInteger(after.rank) || !Number.isSafeInteger(after.popular)
      || !Number.isSafeInteger(after.verified) || typeof after.symbol !== "string"
      || !Number.isSafeInteger(after.chainId) || typeof after.id !== "string") throw new Error("invalid");
    return decoded;
  } catch { throw new CatalogUnavailableError("invalid_cursor"); }
}

function encodeCursor(value: Cursor): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  return btoa(String.fromCharCode(...bytes)).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function sortKey(item: CatalogAsset, query: string, registry: CatalogRegistry): SortKey {
  const rank = !query ? 0 : item.address?.toLowerCase() === query ? 0
    : item.symbol.toLowerCase() === query ? 1
    : item.symbol.toLowerCase().startsWith(query) ? 2
    : item.name.toLowerCase() === query ? 3 : 4;
  return { rank, popular: registry.popular.has(item.id) ? 1 : 0,
    verified: item.verification === "verified" ? 1 : 0,
    symbol: item.symbol, chainId: item.chainId, id: item.id };
}

function compareKeys(a: SortKey, b: SortKey): number {
  return a.rank - b.rank || b.popular - a.popular || b.verified - a.verified
    || a.symbol.localeCompare(b.symbol) || a.chainId - b.chainId || a.id.localeCompare(b.id);
}

function insertCandidate(candidates: Array<{ asset: CatalogAsset; key: SortKey }>, candidate: { asset: CatalogAsset; key: SortKey }): void {
  let low = 0;
  let high = candidates.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (compareKeys(candidates[middle].key, candidate.key) <= 0) low = middle + 1;
    else high = middle;
  }
  if (low >= PAGE_SIZE + 1) return;
  candidates.splice(low, 0, candidate);
  if (candidates.length > PAGE_SIZE + 1) candidates.pop();
}

export async function getCatalogPage(
  input: { query: string; cursor?: string; chainIds: readonly number[] },
  dependencies: Dependencies = {}
): Promise<{ assets: CatalogAsset[]; nextCursor: string | null; observedAt: string; source: "LI.FI" | "Aurel reviewed" }> {
  const fetcher = dependencies.fetcher ?? fetch;
  const now = (dependencies.now ?? Date.now)();
  const registry = dependencies.registry ?? CATALOG_REGISTRY;
  const cache = dependencies.cache ?? (dependencies.fetcher ? createCatalogCache() : defaultCache);
  const query = input.query.trim().toLowerCase();
  if (query.length > 120 || input.chainIds.length < 1 || input.chainIds.length > 5) throw new Error("Invalid catalog query.");
  const chainIds = [...new Set(input.chainIds)].sort((a, b) => a - b);
  if (chainIds.some((id) => !parseAssetId(`${id}:native`))) throw new Error("Unsupported catalog chain.");
  const cursor = input.cursor ? parseCursor(input.cursor) : null;
  if (cursor && (cursor.query !== query || JSON.stringify(cursor.chains) !== JSON.stringify(chainIds))) throw new CatalogUnavailableError("invalid_cursor");
  const observedTimes: string[] = [];
  const snapshotVersions: string[] = [];
  const candidates: Array<{ asset: CatalogAsset; key: SortKey }> = [];
  let snapshots: Snapshot[];
  try { snapshots = await Promise.all(chainIds.map((chainId) => snapshot(chainId, fetcher, cache, now, Boolean(cursor)))); }
  catch (error) {
    if (!(error instanceof CatalogUnavailableError) || error.code !== "provider_unreachable"
      || cursor || !chainIds.includes(8453)) throw error;
    const assets = REVIEWED_BASE_ASSETS.filter((asset) => {
      const screening = screenAsset(asset, registry);
      return screening === "verified" && (!query || asset.symbol.toLowerCase().includes(query)
        || asset.name.toLowerCase().includes(query) || asset.address?.includes(query));
    });
    return { assets, nextCursor: null, observedAt: new Date(now).toISOString(), source: "Aurel reviewed" };
  }
  for (const current of snapshots) {
    observedTimes.push(current.observedAt);
    snapshotVersions.push(current.version);
    for (const item of current.assets) {
      const screening = screenAsset(item, registry);
      if (screening === "denied" || screening === "regulated") continue;
      if (query && !item.symbol.toLowerCase().includes(query) && !item.name.toLowerCase().includes(query)
        && !item.address?.toLowerCase().includes(query)) continue;
      const asset = { ...item, verification: screening };
      const key = sortKey(asset, query, registry);
      if (cursor && compareKeys(key, cursor.after) <= 0) continue;
      insertCandidate(candidates, { asset, key });
    }
  }
  const versions = snapshotVersions.join(":");
  if (cursor && cursor.versions !== versions) throw new CatalogUnavailableError("stale_cursor");
  if (!chainIds.every((id, index) => cache.hasVersion(id, snapshotVersions[index], now))) throw new CatalogUnavailableError("capacity_exceeded");
  const page = candidates.slice(0, PAGE_SIZE);
  const nextCursor = candidates.length > PAGE_SIZE ? encodeCursor({ versions, query, chains: chainIds, after: page[page.length - 1].key }) : null;
  return { assets: page.map((item) => item.asset), nextCursor, observedAt: observedTimes.sort()[0], source: "LI.FI" };
}

export async function resolveCatalogAsset(id: AssetId, dependencies: Dependencies = {}): Promise<CatalogAsset | null> {
  const parsed = parseAssetId(id);
  if (!parsed) return null;
  const fetcher = dependencies.fetcher ?? fetch;
  const cache = dependencies.cache ?? (dependencies.fetcher ? createCatalogCache() : defaultCache);
  let current: Snapshot;
  try { current = await snapshot(parsed.chainId, fetcher, cache, (dependencies.now ?? Date.now)(), false); }
  catch (error) {
    const reviewed = REVIEWED_BASE_ASSETS.find((asset) => asset.id === id);
    if (!(error instanceof CatalogUnavailableError) || error.code !== "provider_unreachable" || !reviewed) throw error;
    return screenAsset(reviewed, dependencies.registry ?? CATALOG_REGISTRY) === "verified" ? reviewed : null;
  }
  const item = current.assets.find((asset) => asset.id === id);
  if (!item) return null;
  const screening = screenAsset(item, dependencies.registry ?? CATALOG_REGISTRY);
  return screening === "denied" || screening === "regulated" ? null : { ...item, verification: screening };
}
