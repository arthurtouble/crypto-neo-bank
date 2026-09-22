import { describe, expect, it, vi } from "vitest";
import { BaseChainSource } from "@/lib/portfolio/chain-source";
import { readCurrentAaveLegs, BaseAaveSource } from "@/lib/portfolio/aave-source";

const accountId = "8453:0x1111111111111111111111111111111111111111" as const;
const txHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const request = { accountId, cursor: null, from: "2026-09-20T00:00:00.000Z", through: "2026-09-21T00:00:00.000Z", limit: 10 };
const tx = { hash: txHash, block_number: 100, timestamp: "2026-09-20T12:00:00Z", from: { hash: accountId.slice(5) }, to: { hash: "0x2222222222222222222222222222222222222222" }, value: "100", status: "ok", gas_used: "2", gas_price: "3", fee: { value: "999" } };
const page = (items: unknown[], next: unknown = null) => ({ items, next_page_params: next });

function chainFetch(responses: Record<string, unknown[]>) {
  const counters: Record<string, number> = {};
  return vi.fn(async (url: string) => {
    const kind = ["transactions", "internal-transactions", "token-transfers"].find((suffix) => new URL(url).pathname.endsWith(`/${suffix}`))!;
    const index = counters[kind] ?? 0;
    counters[kind] = index + 1;
    const result = responses[kind]?.[index] ?? page([]);
    return Response.json(kind === "internal-transactions" ? { meta: { status: 1 }, ...(result as object) } : result);
  });
}
const verified = vi.fn(async () => ({ blockHash, finalized: true, receiptSuccess: true }));

describe("Base chain history source", () => {
  it("requires explicit terminal pages for all three independent streams", async () => {
    const fetcher = chainFetch({ transactions: [page([tx], { block_number: 100, index: 0 }), page([])], "internal-transactions": [page([])], "token-transfers": [page([])] });
    const source = new BaseChainSource({ apiKey: "test", fetcher, verify: verified });
    const first = await source.page(request);
    expect(first.complete).toBe(false);
    expect(first.nextCursor).not.toBeNull();
    const second = await source.page({ ...request, cursor: first.nextCursor });
    expect(second.complete).toBe(true);
    expect(second.nextCursor).toBeNull();
    expect(first.events[0]).toMatchObject({ assetId: "8453:native", rawDelta: "-100", finality: "finalized" });
    expect(first.events.find((item) => item.kind === "fee")?.rawDelta).toBe("-6");
    expect(JSON.parse(first.events[0].evidenceJson)).toHaveProperty("providerDigest");
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("fails closed for absent native page, repeated cursor, duplicate event, malformed units, and changed hash", async () => {
    const missing = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [{ items: [] }], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await missing.page(request)).complete).toBe(false);
    const repeated = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx], { block_number: 100 }), page([], { block_number: 100 })], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    const first = await repeated.page(request);
    expect((await repeated.page({ ...request, cursor: first.nextCursor })).complete).toBe(false);
    const duplicate = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx], { block_number: 100 }), page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    const d1 = await duplicate.page(request);
    expect((await duplicate.page({ ...request, cursor: d1.nextCursor })).complete).toBe(false);
    const malformed = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([{ ...tx, value: "1.5" }])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await malformed.page(request)).complete).toBe(false);
    const changed = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: vi.fn(async () => ({ blockHash, finalized: false, receiptSuccess: false })) });
    expect((await changed.page(request)).complete).toBe(false);
    const token = { block_hash: `0x${"c".repeat(64)}`, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z", from: { hash: accountId.slice(5) }, to: { hash: "0x2222222222222222222222222222222222222222" }, log_index: 1, token_type: "ERC-20", token: { address_hash: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: "6" }, total: { value: "1000000" } };
    const reorg = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([token])] }), verify: verified });
    const reorgPage = await reorg.page(request);
    expect(reorgPage.complete).toBe(false);
    expect(reorgPage.events[0]?.finality).toBe("reorged");
    const partial = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [{ ...page([]), partial: true }], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await partial.page(request)).complete).toBe(false);
    const badInternal = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [{ ...page([]), meta: { status: 0 } }], "token-transfers": [page([])] }), verify: verified });
    expect((await badInternal.page(request)).complete).toBe(false);
  });
});

describe("Base Aave source", () => {
  const reserve = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const market = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
  it("keeps supply and debt as separately signed underlying legs", async () => {
    const call = vi.fn(async (name: string) => name === "get_user_positions" ? { data: { v3: { supplies: [{ market, reserve: { underlyingToken: reserve, decimals: 6 }, balance: "10" }], borrows: [{ market, reserve: { underlyingToken: reserve, decimals: 6 }, balance: "3" }] } } } : { data: { v3: { markets: [{ market }] } } });
    const result = await readCurrentAaveLegs(accountId, { call, now: new Date("2026-09-22T12:00:00Z") });
    expect(result.status).toBe("complete");
    expect(result.legs).toEqual([
      expect.objectContaining({ side: "supply", assetId: `8453:${reserve}`, rawUnits: "10000000" }),
      expect.objectContaining({ side: "debt", assetId: `8453:${reserve}`, rawUnits: "-3000000" })
    ]);
  });

  it("marks ambiguous position shape and activity pagination partial", async () => {
    const result = await readCurrentAaveLegs(accountId, { call: vi.fn(async () => ({ data: { v3: { supplies: [], markets: [] } } })) });
    expect(result.status).toBe("partial");
    const source = new BaseAaveSource({ call: vi.fn(async () => ({ data: { v3: { items: [], pageInfo: {} } } })) });
    expect((await source.page(request)).complete).toBe(false);
  });

  it("finalizes a terminal Aave activity page only with verified chain evidence", async () => {
    const source = new BaseAaveSource({
      call: vi.fn(async () => ({ data: { v3: { items: [{ txHash, timestamp: "2026-09-20T12:00:00Z", reserve: { underlyingToken: reserve, decimals: 6 }, amount: "3", market, __typename: "Borrow", logIndex: 1, blockNumber: 100, blockHash }], pageInfo: { hasNextPage: false } } } })),
      verify: vi.fn(async () => ({ blockHash, receiptSuccess: true, finalized: true }))
    });
    const result = await source.page(request);
    expect(result.complete).toBe(true);
    expect(result.events[0]).toMatchObject({ kind: "borrow", rawDelta: "-3000000", finality: "finalized" });
  });
});
