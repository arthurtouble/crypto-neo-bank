import { describe, expect, it } from "vitest";
import { assetId } from "@/lib/swap/assets";
import { CatalogUnavailableError, createCatalogCache, getCatalogPage, resolveCatalogAsset, screenAsset } from "@/lib/swap/catalog";

const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const LOOKALIKE = "0x0000000000000000000000000000000000000001";
const DENIED = "0x0000000000000000000000000000000000000002";
const REGULATED = "0x0000000000000000000000000000000000000003";

function token(address: string, symbol: string, name = symbol, chainId = 8453, decimals = 6) {
  return { address, symbol, name, chainId, decimals, logoURI: "https://example.com/token.png" };
}

function source(byChain: Record<number, unknown[]>, requests: string[] = []): typeof fetch {
  return async (input) => {
    const url = new URL(String(input));
    requests.push(url.toString());
    return Response.json({ tokens: { [url.searchParams.get("chains") ?? ""]: byChain[Number(url.searchParams.get("chains"))] ?? [] } });
  };
}

const registry = {
  verified: new Set([assetId(8453, USDC)]),
  popular: new Set([assetId(8453, USDC)]),
  denied: new Set([assetId(8453, DENIED)]),
  regulated: new Set([assetId(8453, REGULATED)])
};

describe("LI.FI catalog", () => {
  it("collapses duplicate casing while preserving same-symbol assets on other chains", async () => {
    const fetcher = source({
      8453: [token(USDC, "USDC"), token(USDC.toLowerCase(), "USDC")],
      1: [token("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 1)]
    });
    const page = await getCatalogPage({ query: "USDC", chainIds: [8453, 1] }, { fetcher, registry });
    expect(page.assets.map((item) => item.id)).toEqual([
      "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
      "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"
    ]);
    expect(page.assets[0].verification).toBe("verified");
    expect(page.assets[1].verification).toBe("unverified");
  });

  it("drops malformed metadata and denied or regulated contracts", async () => {
    const fetcher = source({ 8453: [
      token(USDC, "USDC"), token("0x1234", "BAD"), token(LOOKALIKE, "BAD", "bad", 8453, 37),
      token(LOOKALIKE, "WRONG", "wrong chain", 1), token(DENIED, "DENY"), token(REGULATED, "STOCK")
    ] });
    const page = await getCatalogPage({ query: "", chainIds: [8453] }, { fetcher, registry });
    expect(page.assets.map((item) => item.symbol)).toEqual(["USDC"]);
    expect(screenAsset({ id: assetId(8453, DENIED) }, registry)).toBe("denied");
    expect(screenAsset({ id: assetId(8453, REGULATED) }, registry)).toBe("regulated");
  });

  it("recognizes LI.FI native sentinels and the direct chain-map response form", async () => {
    const fetcher: typeof fetch = async () => Response.json({ "8453": [
      token("0x0000000000000000000000000000000000000000", "ETH", "Ether", 8453, 18),
      token("0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee", "ETH", "Ether", 8453, 18)
    ] });
    const page = await getCatalogPage({ query: "ETH", chainIds: [8453] }, { fetcher, registry });
    expect(page.assets.map((item) => ({ id: item.id, address: item.address }))).toEqual([{ id: "8453:native", address: null }]);
  });

  it("omits a duplicated contract when source decimals conflict", async () => {
    const fetcher = source({ 8453: [token(USDC, "USDC", "USD Coin", 8453, 6), token(USDC.toLowerCase(), "USDC", "USD Coin", 8453, 18)] });
    const page = await getCatalogPage({ query: "USDC", chainIds: [8453] }, { fetcher, registry });
    expect(page.assets).toEqual([]);
  });

  it("searches the full snapshot and ranks exact contract before names without dropping lower-ranked results", async () => {
    const fetcher = source({ 8453: [
      token(LOOKALIKE, "USDC", "USDC Lookalike"), token(USDC, "USDC", "USD Coin"),
      token("0x0000000000000000000000000000000000000004", "USDCX", "USD Coin Extra")
    ] });
    const page = await getCatalogPage({ query: "usdc", chainIds: [8453] }, { fetcher, registry });
    expect(page.assets).toHaveLength(3);
    expect(page.assets[0].id).toBe(assetId(8453, USDC));
    const exact = await getCatalogPage({ query: LOOKALIKE.toUpperCase().replace("0X", "0x"), chainIds: [8453] }, { fetcher, registry });
    expect(exact.assets.map((item) => item.id)).toEqual([assetId(8453, LOOKALIKE)]);
  });

  it("uses a bounded cached snapshot and rejects cursors after the snapshot expires", async () => {
    const requests: string[] = [];
    const fetcher = source({ 8453: Array.from({ length: 35 }, (_, index) => token(`0x${(index + 10).toString(16).padStart(40, "0")}`, `TOKEN${index}`)) }, requests);
    let time = 1_000_000;
    const dependencies = { fetcher, registry, now: () => time, cache: createCatalogCache() };
    const first = await getCatalogPage({ query: "", chainIds: [8453] }, dependencies);
    expect(first.assets).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    expect(requests).toHaveLength(1);
    expect(new URL(requests[0]).searchParams.get("minPriceUSD")).toBe("0");
    const second = await getCatalogPage({ query: "", chainIds: [8453], cursor: first.nextCursor! }, dependencies);
    expect(second.assets).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(requests).toHaveLength(1);
    time += 301_000;
    await expect(getCatalogPage({ query: "", chainIds: [8453], cursor: first.nextCursor! }, dependencies)).rejects.toMatchObject({ code: "stale_cursor" });
  });

  it("does not retain a pending provider request across searches", async () => {
    let calls = 0;
    const fetcher: typeof fetch = async () => {
      calls++;
      await new Promise((resolve) => setTimeout(resolve, 10));
      return Response.json({ tokens: { "8453": [token(USDC, "USDC")] } });
    };
    const [bySymbol, byName] = await Promise.all([
      getCatalogPage({ query: "USDC", chainIds: [8453] }, { fetcher, registry }),
      getCatalogPage({ query: "USD Coin", chainIds: [8453] }, { fetcher, registry })
    ]);
    expect(bySymbol.assets).toHaveLength(1);
    expect(byName.assets).toHaveLength(0);
    expect(calls).toBe(2);
  });

  it("stops a chunked provider body at the byte limit before JSON parsing", async () => {
    let cancelled = false;
    const chunk = new Uint8Array(1_500_000).fill(32);
    const fetcher: typeof fetch = async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(chunk);
        controller.enqueue(chunk);
        controller.enqueue(chunk);
      },
      cancel() { cancelled = true; }
    }));
    await expect(getCatalogPage({ query: "", chainIds: [8453] }, { fetcher, cache: createCatalogCache() })).rejects.toMatchObject({ code: "provider_unavailable" });
    expect(cancelled).toBe(true);
  });

  it("accepts a measured-size Ethereum catalog above the former 2 MB cap", async () => {
    const tokens = Array.from({ length: 6_000 }, (_, index) => token(`0x${(index + 100).toString(16).padStart(40, "0")}`, `ETH${index}`, `Ethereum Token ${index}`, 1, 18));
    const base = JSON.stringify({ tokens: { "1": tokens } });
    const body = JSON.stringify({ tokens: { "1": tokens }, providerMetadata: "x".repeat(2_700_000 - new TextEncoder().encode(base).byteLength - 24) });
    expect(new TextEncoder().encode(body).byteLength).toBeGreaterThan(2_690_131);
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(4_000_000);
    const fetcher: typeof fetch = async () => new Response(body, { headers: { "Content-Type": "application/json" } });
    const cache = createCatalogCache();
    const page = await getCatalogPage({ query: "ETH", chainIds: [1] }, { fetcher, cache });
    expect(page.assets).toHaveLength(30);
    expect(page.nextCursor).toBeTruthy();
    expect(cache.sizeBytes).toBeLessThanOrEqual(8_000_000);
  });

  it("bounds aggregate cached metadata and rejects a union that cannot remain stable", async () => {
    const fetcher = source({ 8453: [token(USDC, "USDC")], 1: [token("0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", "USDC", "USD Coin", 1)] });
    const probe = createCatalogCache();
    await getCatalogPage({ query: "", chainIds: [8453] }, { fetcher, cache: probe });
    const limit = probe.sizeBytes + 10;
    const cache = createCatalogCache(limit);
    await expect(getCatalogPage({ query: "", chainIds: [8453, 1] }, { fetcher, cache })).rejects.toMatchObject({ code: "capacity_exceeded" });
    expect(cache.sizeBytes).toBeLessThanOrEqual(limit);
  });

  it("preserves Unicode search text across pages", async () => {
    const fetcher = source({ 8453: Array.from({ length: 31 }, (_, index) => token(`0x${(index + 100).toString(16).padStart(40, "0")}`, `币${index}`, `测试币 ${index}`)) });
    const cache = createCatalogCache();
    const first = await getCatalogPage({ query: "币", chainIds: [8453] }, { fetcher, cache });
    expect(first.assets).toHaveLength(30);
    expect(first.nextCursor).toBeTruthy();
    const second = await getCatalogPage({ query: "币", chainIds: [8453], cursor: first.nextCursor! }, { fetcher, cache });
    expect(second.assets).toHaveLength(1);
  });

  it("fails closed when the provider times out or a refresh cannot replace an expired snapshot", async () => {
    let time = 1_000_000;
    let offline = false;
    const fetcher: typeof fetch = async () => {
      if (offline) throw new Error("timeout");
      return Response.json({ tokens: { "8453": [token(USDC, "USDC")] } });
    };
    const dependencies = { fetcher, registry, now: () => time, cache: createCatalogCache() };
    expect((await getCatalogPage({ query: "", chainIds: [8453] }, dependencies)).assets).toHaveLength(1);
    time += 301_000;
    offline = true;
    await expect(getCatalogPage({ query: "", chainIds: [8453] }, dependencies)).rejects.toBeInstanceOf(CatalogUnavailableError);
  });

  it("resolves exact supported contracts only and never treats a matching symbol as support", async () => {
    const fetcher = source({ 8453: [token(USDC, "USDC"), token("0x0000000000000000000000000000000000000005", "NOTUSDC")] });
    const dependencies = { fetcher, registry };
    expect((await resolveCatalogAsset(assetId(8453, USDC), dependencies))?.id).toBe(assetId(8453, USDC));
    expect(await resolveCatalogAsset(assetId(8453, LOOKALIKE), dependencies)).toBeNull();
    expect(await resolveCatalogAsset("8453:0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", dependencies)).toBeNull();
  });

  it("rejects unsupported chains and oversized queries", async () => {
    const fetcher = source({});
    await expect(getCatalogPage({ query: "", chainIds: [56] }, { fetcher })).rejects.toThrow();
    await expect(getCatalogPage({ query: "x".repeat(121), chainIds: [8453] }, { fetcher })).rejects.toThrow();
  });
});
