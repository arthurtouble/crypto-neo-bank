import { afterEach, describe, expect, it, vi } from "vitest";
import {
  accountState, accountStates, cctpForwardFee, perpAssetId, perpDexs, userAbstraction, extraAgents, hyperliquidApiUrl, nonFundingLedgerUpdates, openOrders, perpMarkets, userFills
} from "@/lib/markets/hyperliquid/info";
import { VenueError } from "@/lib/markets/types";

const user = "0xF5D81A135F756CA16544E53C20FC20643EC3AD53";

// Trimmed from real api.hyperliquid.xyz answers.
const metaAndAssetCtxs = [
  { universe: [
    { szDecimals: 5, name: "BTC", maxLeverage: 40, marginTableId: 56 },
    { szDecimals: 1, name: "MATIC", maxLeverage: 20, marginTableId: 20, isDelisted: true },
    { szDecimals: 2, name: "ATOM", maxLeverage: 5, marginTableId: 5, marginMode: "strictIsolated" },
    { szDecimals: 0, name: "QUIET", maxLeverage: 3, marginTableId: 3, onlyIsolated: true }
  ], marginTables: [], collateralToken: 0 },
  [
    { funding: "-0.0000070599", openInterest: "36778.67414", prevDayPx: "86193.0", dayNtlVlm: "2612352559.1906294823",
      premium: "-0.000508034", oraclePx: "84640.0", markPx: "84592.0", midPx: "84596.5", impactPxs: ["84596.0", "84597.0"],
      dayBaseVlm: "30526.73635" },
    { funding: "0.0", openInterest: "0.0", prevDayPx: "0.37621", dayNtlVlm: "0.0", premium: null, oraclePx: "0.3754",
      markPx: "0.37621", midPx: null, impactPxs: null, dayBaseVlm: "0.0" },
    { funding: "0.0000125", openInterest: "120.5", prevDayPx: "4.5", dayNtlVlm: "1000.0", premium: "0.0", oraclePx: "4.4",
      markPx: "4.41", midPx: "4.405", impactPxs: ["4.4", "4.41"], dayBaseVlm: "220.0" },
    { funding: "0.0", openInterest: "0.0", prevDayPx: "1.0", dayNtlVlm: "0.0", premium: null, oraclePx: "1.0",
      markPx: "1.0", midPx: null, impactPxs: null, dayBaseVlm: "0.0" }
  ]
];

const clearinghouseState = {
  marginSummary: { accountValue: "1500.25", totalNtlPos: "1362.7", totalRawUsd: "2862.9", totalMarginUsed: "454.24" },
  crossMarginSummary: { accountValue: "1500.25", totalNtlPos: "1362.7", totalRawUsd: "2862.9", totalMarginUsed: "454.24" },
  crossMaintenanceMarginUsed: "10.0",
  withdrawable: "1046.01",
  assetPositions: [
    { type: "oneWay", position: { coin: "BTC", szi: "-0.01611", leverage: { type: "cross", value: 3 }, entryPx: "84571.1",
      positionValue: "1362.72", unrealizedPnl: "-0.11", returnOnEquity: "-0.0002437193", liquidationPx: "180600.2115010886",
      marginUsed: "454.24", maxLeverage: 40, cumFunding: { allTime: "-24.2", sinceOpen: "-0.08", sinceChange: "0.0" } } },
    { type: "oneWay", position: { coin: "ETH", szi: "0.5", leverage: { type: "isolated", value: 5, rawUsd: "-1000.0" },
      entryPx: "2682.54", positionValue: "1342.27", unrealizedPnl: "1.0", returnOnEquity: "0.0037", liquidationPx: null,
      marginUsed: "268.4", maxLeverage: 25, cumFunding: { allTime: "0.0", sinceOpen: "0.0", sinceChange: "0.0" } } }
  ],
  time: 1791018933070
};

function fetcherFor(payload: unknown, init?: ResponseInit) {
  return vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
    void input; void request;
    return Response.json(payload, init);
  });
}

function sentBody(fetcher: ReturnType<typeof fetcherFor>): unknown {
  return JSON.parse(String(fetcher.mock.calls[0][1]?.body));
}

afterEach(() => { vi.unstubAllEnvs(); });

describe("Hyperliquid info reads", () => {
  it("lists tradable main-dex perps with their universe index", async () => {
    const fetcher = fetcherFor(metaAndAssetCtxs);
    const markets = await perpMarkets({ fetcher, dexes: "main" });
    expect(fetcher.mock.calls[0][0]).toBe("https://api.hyperliquid.xyz/info");
    expect(sentBody(fetcher)).toEqual({ type: "metaAndAssetCtxs" });
    expect(markets.map((market) => [market.coin, market.assetIndex, market.onlyIsolated ?? false]))
      .toEqual([["BTC", 0, false], ["ATOM", 2, true], ["QUIET", 3, true]]);
    expect(markets[0]).toEqual({ coin: "BTC", dex: "", assetIndex: 0, szDecimals: 5, maxLeverage: 40, markPx: "84592.0",
      midPx: "84596.5", oraclePx: "84640.0", prevDayPx: "86193.0", dayNtlVlm: "2612352559.1906294823",
      funding: "-0.0000070599", openInterest: "36778.67414" });
    expect(markets[2].midPx).toBeNull();
  });

  it("refuses a universe and context list that do not line up", async () => {
    await expect(perpMarkets({ fetcher: fetcherFor([metaAndAssetCtxs[0], []]), dexes: "main" }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it("reads account value, withdrawable, and signed positions for a lowercase user", async () => {
    const fetcher = fetcherFor(clearinghouseState);
    const state = await accountState(user, { fetcher });
    expect(sentBody(fetcher)).toEqual({ type: "clearinghouseState", user: user.toLowerCase() });
    expect(state).toMatchObject({ dex: "", accountValue: "1500.25", totalMarginUsed: "454.24", withdrawable: "1046.01",
      crossAccountValue: "1500.25", crossMaintenanceMarginUsed: "10.0", time: 1791018933070 });
    expect(state.positions).toEqual([
      { coin: "BTC", size: "-0.01611", entryPx: "84571.1", positionValue: "1362.72", unrealizedPnl: "-0.11",
        returnOnEquity: "-0.0002437193", liquidationPx: "180600.2115010886", leverage: { type: "cross", value: 3 }, marginUsed: "454.24" },
      { coin: "ETH", size: "0.5", entryPx: "2682.54", positionValue: "1342.27", unrealizedPnl: "1.0", returnOnEquity: "0.0037",
        liquidationPx: null, leverage: { type: "isolated", value: 5 }, marginUsed: "268.4" }
    ]);
  });

  it("reads open orders with plain sides", async () => {
    const orders = await openOrders(user, { fetcher: fetcherFor([{ coin: "ZEC", side: "A", limitPx: "1314.9", sz: "2.19",
      oid: 564243798110, timestamp: 1791018943957, triggerCondition: "N/A", isTrigger: false, triggerPx: "0.0", children: [],
      isPositionTpsl: false, reduceOnly: false, orderType: "Limit", origSz: "2.19", tif: "Alo",
      cloid: "0x9a900faccdee0c4338475ec4fdee9ab4" }]) });
    expect(orders).toEqual([{ coin: "ZEC", side: "sell", limitPx: "1314.9", size: "2.19", origSize: "2.19", oid: 564243798110,
      timestamp: 1791018943957, orderType: "Limit", reduceOnly: false, isTrigger: false, triggerPx: "0.0", isPositionTpsl: false,
      tif: "Alo" }]);
  });

  it("reads approved agents", async () => {
    await expect(extraAgents(user, { fetcher: fetcherFor([{ name: "Aura", address: "0xEB94CEF148C230D09103DDE1D40D2B3C06614CCC",
      validUntil: 1791206708046 }]) }))
      .resolves.toEqual([{ name: "Aura", address: "0xeb94cef148c230d09103dde1d40d2b3c06614ccc", validUntil: 1791206708046 }]);
  });

  it("keeps only deposits and withdrawals from the ledger", async () => {
    const fetcher = fetcherFor([
      { time: 1765994269696, hash: `0x${"70".repeat(32)}`, delta: { type: "deposit", usdc: "49.8" } },
      { time: 1770000000000, hash: `0x${"71".repeat(32)}`, delta: { type: "send", usdc: "5.0", destination: user } },
      { time: 1778559896578, hash: `0x${"e2".repeat(32)}`, delta: { type: "withdraw", usdc: "87.0", nonce: 1778559612628000, fee: "1.0" } }
    ]);
    await expect(nonFundingLedgerUpdates(user, 1_700_000_000_000, { fetcher })).resolves.toEqual([
      { kind: "deposit", route: "bridge", usdc: "49.8", fee: "0", dex: "", hash: `0x${"70".repeat(32)}`, time: 1765994269696 },
      { kind: "withdraw", route: "bridge", usdc: "87.0", fee: "1.0", dex: "", hash: `0x${"e2".repeat(32)}`, time: 1778559896578 }
    ]);
    expect(sentBody(fetcher)).toEqual({ type: "userNonFundingLedgerUpdates", user: user.toLowerCase(), startTime: 1_700_000_000_000 });
  });

  it("reads recent fills up to a limit", async () => {
    const fill = { coin: "HYPE", px: "87.741", sz: "0.14", side: "A", time: 1791018944025, startPosition: "648.15",
      dir: "Close Long", closedPnl: "-0.001974", hash: `0x${"0".repeat(64)}`, oid: 564243528750, crossed: false,
      fee: "-0.000245", tid: 1092219554287259, cloid: null, feeToken: "USDC", twapId: null };
    const fills = await userFills(user, { fetcher: fetcherFor([fill, { ...fill, side: "B", tid: 2 }]), limit: 1 });
    expect(fills).toEqual([{ coin: "HYPE", px: "87.741", size: "0.14", side: "sell", time: 1791018944025, dir: "Close Long",
      closedPnl: "-0.001974", fee: "-0.000245", feeToken: "USDC", oid: 564243528750, tid: 1092219554287259,
      hash: `0x${"0".repeat(64)}` }]);
  });

  it("maps failures to VenueError and never calls out for a bad address", async () => {
    const fetcher = fetcherFor({});
    await expect(accountState("0x12", { fetcher })).rejects.toMatchObject({ code: "invalid_address", status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
    await expect(accountState(user, { fetcher: fetcherFor({}, { status: 429 }) })).rejects.toMatchObject({ code: "rate_limited" });
    await expect(accountState(user, { fetcher: fetcherFor({}, { status: 500 }) })).rejects.toMatchObject({ code: "unavailable" });
    await expect(accountState(user, { fetcher: fetcherFor({ marginSummary: {} }) })).rejects.toBeInstanceOf(VenueError);
    const failing = vi.fn(async () => { throw new TypeError("network"); });
    await expect(openOrders(user, { fetcher: failing })).rejects.toMatchObject({ code: "unavailable" });
    const huge = vi.fn(async () => new Response("[]", { headers: { "content-length": "99999999" } }));
    await expect(extraAgents(user, { fetcher: huge })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("honours HYPERLIQUID_API_URL only for loopback fakes", () => {
    vi.stubEnv("HYPERLIQUID_API_URL", "http://127.0.0.1:4010/");
    expect(hyperliquidApiUrl()).toBe("http://127.0.0.1:4010");
    vi.stubEnv("HYPERLIQUID_API_URL", "https://evil.example");
    expect(hyperliquidApiUrl()).toBe("https://api.hyperliquid.xyz");
  });
});

const hip3 = (name: string, assets: Array<Record<string, unknown>>, collateralToken = 0) =>
  ({ universe: assets.map((asset) => ({ szDecimals: 2, maxLeverage: 10, marginTableId: 10, ...asset, name: `${name}:${String(asset.name)}` })),
    collateralToken });
const ctx = { funding: "0.00000625", openInterest: "7722.0", prevDayPx: "150.0", dayNtlVlm: "294820.8", premium: "0.0",
  oraclePx: "159.0", markPx: "159.02", midPx: "159.03", impactPxs: null, dayBaseVlm: "1.0" };

describe("Hyperliquid HIP-3 dexes", () => {
  // Shaped like allPerpMetas: index = dex index; xyz is USDC-margined, flx uses another collateral, sport is screened out.
  const xyz = hip3("xyz", [{ name: "XYZ100" }, { name: "OLD", isDelisted: true }, { name: "SPCX", szDecimals: 2, maxLeverage: 20 }]);
  const allPerpMetas = [
    { ...metaAndAssetCtxs[0] as object, collateralToken: 0 },
    xyz,
    hip3("flx", [{ name: "TSLA" }], 360),
    hip3("gone", [{ name: "A", isDelisted: true }]),
    hip3("sportx", [{ name: "LAKERS" }])
  ];

  function hip3Fetcher() {
    return vi.fn(async (input: RequestInfo | URL, request?: RequestInit) => {
      void input;
      const body = JSON.parse(String(request?.body)) as { type: string; dex?: string };
      if (body.type === "allPerpMetas") return Response.json(allPerpMetas);
      if (body.type === "metaAndAssetCtxs" && body.dex === "xyz") {
        return Response.json([{ universe: xyz.universe }, [ctx, ctx, { ...ctx, markPx: "159.5" }]]);
      }
      if (body.type === "metaAndAssetCtxs" && !body.dex) return Response.json(metaAndAssetCtxs);
      if (body.type === "clearinghouseState") return Response.json({ ...clearinghouseState, assetPositions: [] });
      return new Response("unexpected", { status: 400 });
    });
  }

  it("computes HIP-3 asset ids as 100000 + dex index × 10000 + index", () => {
    expect(perpAssetId(0, 7)).toBe(7);
    expect(perpAssetId(1, 76)).toBe(110_076);
    expect(perpAssetId(9, 3)).toBe(190_003);
    expect(() => perpAssetId(1, 10_000)).toThrow(VenueError);
  });

  it("lists USDC-margined, non-sports dexes with live markets", async () => {
    await expect(perpDexs({ fetcher: hip3Fetcher() })).resolves.toEqual([{ name: "", index: 0 }, { name: "xyz", index: 1 }]);
  });

  it("lists HIP-3 markets with their dex and asset id, after the main dex", async () => {
    const fetcher = hip3Fetcher();
    const markets = await perpMarkets({ fetcher });
    expect(markets.map((market) => [market.coin, market.dex, market.assetIndex])).toEqual([
      ["BTC", "", 0], ["ATOM", "", 2], ["QUIET", "", 3], ["xyz:XYZ100", "xyz", 110_000], ["xyz:SPCX", "xyz", 110_002]
    ]);
    expect(markets.at(-1)).toMatchObject({ szDecimals: 2, maxLeverage: 20, markPx: "159.5", midPx: "159.03" });
    const bodies = fetcher.mock.calls.map(([, init]) => JSON.parse(String(init?.body)) as unknown);
    expect(bodies).toEqual([{ type: "allPerpMetas" }, { type: "metaAndAssetCtxs" }, { type: "metaAndAssetCtxs", dex: "xyz" }]);
  });

  it("reads each dex's account with its dex name", async () => {
    const fetcher = hip3Fetcher();
    const states = await accountStates(user, [{ name: "", index: 0 }, { name: "xyz", index: 1 }], { fetcher });
    expect(states.map((state) => state.dex)).toEqual(["", "xyz"]);
    expect(JSON.parse(String(fetcher.mock.calls[1][1]?.body))).toEqual({ type: "clearinghouseState", user: user.toLowerCase(), dex: "xyz" });
    await expect(accountState(user, { fetcher, dex: "../x" })).rejects.toMatchObject({ code: "invalid_request" });
  });

  it("reads open orders on a HIP-3 dex", async () => {
    const fetcher = fetcherFor([]);
    await openOrders(user, { fetcher, dex: "xyz" });
    expect(sentBody(fetcher)).toEqual({ type: "frontendOpenOrders", user: user.toLowerCase(), dex: "xyz" });
  });

  it("reports the account's abstraction mode", async () => {
    await expect(userAbstraction(user, { fetcher: fetcherFor("disabled") })).resolves.toBe("standard");
    await expect(userAbstraction(user, { fetcher: fetcherFor("unifiedAccount") })).resolves.toBe("unifiedAccount");
    await expect(userAbstraction(user, { fetcher: fetcherFor("somethingNew") })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("recognises CCTP deposits in the ledger as sends from the CoreDepositWallet", async () => {
    const owner = user.toLowerCase();
    const fetcher = fetcherFor([
      { time: 1791019283344, hash: `0x${"c3".repeat(32)}`, delta: { type: "send", user: "0x6b9e773128f453f5c2c60935ee2de2cbc5390a24",
        destination: owner, sourceDex: "spot", destinationDex: "", token: "USDC", amount: "182.2", usdcValue: "182.2", fee: "0.0",
        nativeTokenFee: "0.0", nonce: 3831512, feeToken: "" } },
      { time: 1791019290000, hash: `0x${"c4".repeat(32)}`, delta: { type: "send", user: owner, destination: owner, sourceDex: "",
        destinationDex: "xyz", token: "USDC", amount: "50.0", usdcValue: "50.0", fee: "0.0", nativeTokenFee: "0.0", nonce: 1, feeToken: "" } }
    ]);
    await expect(nonFundingLedgerUpdates(user, 0, { fetcher })).resolves.toEqual([
      { kind: "deposit", route: "cctp", usdc: "182.2", fee: "0", dex: "", hash: `0x${"c3".repeat(32)}`, time: 1791019283344 }
    ]);
  });
});

describe("CCTP forwarding fee", () => {
  it("reads cctpForwardFees(domain) from the CoreDepositWallet and returns USDC", async () => {
    const fetcher = fetcherFor({ jsonrpc: "2.0", id: 1, result: `0x${(1_200_000).toString(16).padStart(64, "0")}` });
    await expect(cctpForwardFee(0, { fetcher })).resolves.toBe("1.2");
    expect(fetcher.mock.calls[0][0]).toBe("https://rpc.hyperliquid.xyz/evm");
    expect(sentBody(fetcher)).toEqual({ jsonrpc: "2.0", id: 1, method: "eth_call", params: [{
      to: "0x6B9E773128f453f5c2C60935Ee2DE2CBc5390A24", data: `0xb49595b7${"0".repeat(64)}` }, "latest"] });
  });

  it("reports a revert or bad answer as invalid rather than a zero fee", async () => {
    await expect(cctpForwardFee(6, { fetcher: fetcherFor({ jsonrpc: "2.0", id: 1, error: { code: 3, message: "reverted" } }) }))
      .rejects.toMatchObject({ code: "invalid_response" });
    await expect(cctpForwardFee(-1, { fetcher: fetcherFor({}) })).rejects.toMatchObject({ code: "invalid_request" });
  });
});
