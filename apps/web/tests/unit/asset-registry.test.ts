import type { DatabaseSync } from "node:sqlite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ASSETS, assetFor, assetsFor, registeredAsset } from "@/lib/assets/registry";
import { requireAsset, requireNotPaused } from "@/lib/assets/pauses";
import { depositDestination, depositSource, DEPOSIT_NETWORKS } from "@/lib/deposits/networks";
import { investAssets, investCategories } from "@/lib/invest/catalog";
import { valueAsset } from "@/lib/actions/valuation";
import { d1 } from "../support/d1";
import { schemaDatabase } from "../support/schema";
const httpErrors = await vi.hoisted(() => import("@/lib/http/errors"));

const baseUsdc = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const state = vi.hoisted(() => ({ db: null as D1Database | null, admin: true }));
vi.mock("cloudflare:workers", () => ({ env: { get PROJECTION_DB() { return state.db; } } }));
vi.mock("@/lib/auth/admin", () => ({ requireOperationsAdmin: async () => {
  if (!state.admin) throw new httpErrors.AuthorizationError();
  return { subjectReference: "did:privy:operator" };
} }));
const { GET: listAssets, PATCH: updateAsset } = await import("@/app/api/ops/assets/route");
const patch = (body: unknown) => updateAsset(new Request("https://aura.test/api/ops/assets", { method: "PATCH", body: JSON.stringify(body) }));

describe("the asset registry", () => {
  it("identifies every asset by network and lowercase contract, once", () => {
    expect(new Set(ASSETS.map((asset) => asset.id)).size).toBe(ASSETS.length);
    for (const asset of ASSETS) {
      expect(asset.id).toBe(`${asset.chainId}:${asset.address ?? "native"}`);
      if (asset.address) expect(asset.address).toMatch(/^0x[0-9a-f]{40}$/);
      else expect(asset.decimals).toBe(18);
      expect(asset.uses.length).toBeGreaterThan(0);
    }
  });

  it("holds, sends, and invests only on Base, where the account keeps funds", () => {
    for (const use of ["hold", "send", "invest"] as const) expect(assetsFor(use).every((asset) => asset.chainId === 8453), use).toBe(true);
  });

  it("gives every deposit source the same asset on Base to land in, and every network something to deposit", () => {
    for (const asset of assetsFor("deposit")) expect(depositDestination(asset.symbol), asset.id).not.toBeNull();
    for (const network of DEPOSIT_NETWORKS) expect(assetsFor("deposit", network.chainId).length, network.name).toBeGreaterThan(0);
    expect(depositSource(137, "ETH")).toBeNull();
  });

  it("offers today's assets: USDC, ETH, WETH, and cbBTC on Base, with ETH and USDC deposits from four other networks", () => {
    expect(assetsFor("send").map((asset) => asset.symbol)).toEqual(["ETH", "USDC", "WETH", "cbBTC"]);
    expect(assetsFor("deposit").map((asset) => `${asset.symbol}@${asset.chainId}`)).toEqual(
      ["ETH@8453", "USDC@8453", "ETH@1", "USDC@1", "ETH@42161", "USDC@42161", "ETH@10", "USDC@10", "USDC@137"]);
    expect(investAssets.map((asset) => asset.symbol)).toEqual(["ETH", "cbBTC"]);
    expect(investCategories.map((category) => [category.key, category.available])).toEqual([["crypto", true], ["stocks", false], ["metals", false]]);
  });

  it("finds an asset only for the uses it has", () => {
    expect(assetFor(baseUsdc.toUpperCase().replace("0X", "0x"), "send")?.symbol).toBe("USDC");
    expect(assetFor(baseUsdc, "invest")).toBeNull();
    expect(registeredAsset("8453:0x1111111111111111111111111111111111111111")).toBeNull();
  });

  it("values an asset from its registry price source", async () => {
    expect(await valueAsset({ assetId: baseUsdc, amountRaw: "2500000", decimals: 6 })).toEqual({ usdCents: 250, source: "stablecoin:par" });
    const kraken = vi.fn(async () => Response.json({ error: [], result: { XETHZUSD: [[Math.floor(Date.now() / 1000) - 30, "2000", "2000", "2000", "2000", "2000", "1", 1]] } }));
    expect(await valueAsset({ assetId: "8453:native", amountRaw: "500000000000000000", decimals: 18 }, { fetcher: kraken })).toMatchObject({ usdCents: 100000 });
    expect(await valueAsset({ assetId: "8453:0x1111111111111111111111111111111111111111", amountRaw: "1", decimals: 18 })).toEqual({ usdCents: null, source: null });
  });
});

describe("pausing an asset", () => {
  let sqlite: DatabaseSync;
  beforeEach(() => { sqlite = schemaDatabase(); state.db = d1(sqlite); state.admin = true; });
  afterEach(() => sqlite.close());

  it("refuses an unregistered asset, a use it doesn't have, and a paused asset", async () => {
    await expect(requireAsset(state.db!, "8453:0x1111111111111111111111111111111111111111", "send")).rejects.toMatchObject({ status: 422, code: "unsupported_asset" });
    await expect(requireAsset(state.db!, baseUsdc, "invest")).rejects.toMatchObject({ status: 422, code: "unsupported_asset" });
    expect((await requireAsset(state.db!, baseUsdc, "send")).symbol).toBe("USDC");
    await patch({ assetId: baseUsdc, paused: true, reason: "Depeg under review" });
    await expect(requireAsset(state.db!, baseUsdc, "send")).rejects.toMatchObject({ status: 503, code: "asset_paused", message: "USDC is paused right now. Try again later." });
    await expect(requireNotPaused(state.db!, baseUsdc)).rejects.toMatchObject({ code: "asset_paused" });
    await requireNotPaused(state.db!, "8453:native");
  });

  it("lets an operator pause with a reason and resume, and audits both", async () => {
    expect((await patch({ assetId: baseUsdc, paused: true })).status).toBe(400);
    expect((await patch({ assetId: baseUsdc, paused: true, reason: "Issuer halt" })).status).toBe(200);
    const listed = await (await listAssets(new Request("https://aura.test/api/ops/assets"))).json() as { assets: Array<{ id: string; paused: { reason: string; by: string } | null }> };
    expect(listed.assets.find((asset) => asset.id === baseUsdc)?.paused).toMatchObject({ reason: "Issuer halt", by: "did:privy:operator" });
    expect(listed.assets.filter((asset) => asset.paused)).toHaveLength(1);
    expect((await patch({ assetId: baseUsdc, paused: false })).status).toBe(200);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM asset_pauses").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT action, target_reference FROM audit_events ORDER BY occurred_at, action DESC").all())
      .toEqual([{ action: "asset.paused", target_reference: baseUsdc }, { action: "asset.resumed", target_reference: baseUsdc }]);
  });

  it("can only pause assets in the registry, and only for operators", async () => {
    expect((await patch({ assetId: "8453:0x1111111111111111111111111111111111111111", paused: true, reason: "x" })).status).toBe(404);
    state.admin = false;
    expect((await patch({ assetId: baseUsdc, paused: true, reason: "x" })).status).toBe(403);
    expect((await listAssets(new Request("https://aura.test/api/ops/assets"))).status).toBe(403);
  });
});
