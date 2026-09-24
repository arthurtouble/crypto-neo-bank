import { describe, expect, it, vi } from "vitest";
import { encodeAbiParameters, encodeEventTopics, padHex, parseAbiItem, toHex } from "viem";
import { BaseChainSource } from "@/lib/portfolio/chain-source";
import { BaseAaveSource } from "@/lib/portfolio/aave-source";
import { normalizeEconomicEvents } from "@/lib/portfolio/normalize";
import { calculatePortfolioDays } from "@/lib/portfolio/calculate";

const accountId = "8453:0x1111111111111111111111111111111111111111" as const;
const txHash = `0x${"a".repeat(64)}`;
const blockHash = `0x${"b".repeat(64)}`;
const request = { accountId, cursor: null, from: "2026-09-20T00:00:00.000Z", through: "2026-09-21T00:00:00.000Z", limit: 10 };
const tx = { hash: txHash, block_number: 100, block_hash: blockHash, timestamp: "2026-09-20T12:00:00Z", from: { hash: accountId.slice(5) }, to: { hash: "0x2222222222222222222222222222222222222222" }, value: "100", status: "ok", gas_used: "2", gas_price: "3", fee: { value: "999" } };
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
const verified = vi.fn(async () => ({ blockHash, blockTimestamp: BigInt(Date.parse("2026-09-20T12:00:00.000Z") / 1000), finalized: true, receiptSuccess: true,
  transaction: { hash: txHash, blockHash, blockNumber: 100n, from: accountId.slice(5), to: tx.to.hash, value: 100n },
  fee: { gasUsed: 2n, effectiveGasPrice: 3n, l1Fee: 1n, operatorFee: 0n } }));

describe("Base chain history source", () => {
  it("uses a matching receipt log and on-chain precision to prove linked-wallet token transfers", async () => {
    const other = "8453:0x2222222222222222222222222222222222222222" as const;
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const transfer = { block_hash: blockHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: accountId.slice(5) }, to: { hash: other.slice(5) }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: tokenAddress, decimals: "6" }, total: { value: "2000000" } };
    const log = { address: tokenAddress, logIndex: 1,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", padHex(accountId.slice(5) as `0x${string}`, { size: 32 }), padHex(other.slice(5) as `0x${string}`, { size: 32 })],
      data: toHex(2_000_000n, { size: 32 }) };
    const fetcher = chainFetch({ transactions: [page([]), page([])], "internal-transactions": [page([]), page([])], "token-transfers": [page([transfer]), page([transfer])] });
    const source = new BaseChainSource({ apiKey: "test", fetcher, verify: vi.fn(async () => ({ blockHash, blockTimestamp: BigInt(Date.parse("2026-09-20T12:00:00.000Z") / 1000), finalized: true, receiptSuccess: true, logs: [log], tokenDecimals: 6 })) });
    const outbound = await source.page(request);
    const inbound = await source.page({ ...request, accountId: other });
    expect(outbound.complete && inbound.complete).toBe(true);
    const normalized = normalizeEconomicEvents([...outbound.events, ...inbound.events], new Set([accountId, other]));
    expect(normalized.unresolved).toEqual([]);
    expect(normalized.events.map((event) => event.kind)).toEqual(["internal_transfer", "internal_transfer"]);
    const acquisition = { ...outbound.events[0], sourceEventId: "documented-acquisition", occurredAt: "2026-09-19T12:00:00.000Z",
      rawDelta: "2000000", kind: "contribution" as const, groupId: "prior-deposit", counterpartyAccountId: null,
      evidenceJson: '{"taxSupport":{"acquisitionCostUsd":"1.8","evidenceReference":"provider:deposit-1"}}' };
    const assetId = outbound.events[0].assetId;
    const prices = ["2026-09-19", "2026-09-20"].map((day) => ({ assetId, day, usd: "1", sourceId: "independent-price",
      observedAt: `${day}T23:59:59.000Z`, methodology: "USD-close", version: 1 }));
    const coverage = ["2026-09-19", "2026-09-20"].flatMap((day) => [accountId, other].map((id) => ({ day, accountId: id,
      sourceId: "blockscout:8453", eventStatus: "complete" as const, priceStatus: "complete" as const, reason: null })));
    const calculation = calculatePortfolioDays({ events: [acquisition, ...normalized.events], prices, coverage, calculationVersion: 2 });
    expect(calculation.disposals).toEqual([]);
    expect(calculation.lots.find((lot) => lot.accountId === other)).toMatchObject({ rawRemaining: "2000000", basisUsd: "1.8", classification: "supported" });
  });

  it("does not complete history from a token row contradicted by its receipt", async () => {
    const to = "0x2222222222222222222222222222222222222222";
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const transfer = { block_hash: blockHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: accountId.slice(5) }, to: { hash: to }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: tokenAddress, decimals: "6" }, total: { value: "2000000" } };
    const log = { address: tokenAddress, logIndex: 1,
      topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", padHex(accountId.slice(5) as `0x${string}`, { size: 32 }), padHex(to as `0x${string}`, { size: 32 })],
      data: toHex(2_000_000n, { size: 32 }) };
    for (const proof of [
      { logs: [{ ...log, data: toHex(1_000_000n, { size: 32 }) }], tokenDecimals: 6 },
      { logs: [{ ...log, logIndex: 2 }], tokenDecimals: 6 },
      { logs: [log], tokenDecimals: 18 },
      { logs: [], tokenDecimals: 6 }
    ]) {
      const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([transfer])] }),
        verify: vi.fn(async () => ({ blockHash, finalized: true, receiptSuccess: true, ...proof })) });
      const result = await source.page(request);
      expect(result.complete).toBe(false);
      expect(result.events).toEqual([]);
    }
  });

  it("does not attach an owned counterparty to an unsuccessful receipt", async () => {
    const to = "0x2222222222222222222222222222222222222222";
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const transfer = { block_hash: blockHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: accountId.slice(5) }, to: { hash: to }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: tokenAddress, decimals: "6" }, total: { value: "2000000" } };
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([transfer])] }),
      verify: vi.fn(async () => ({ blockHash, finalized: true, receiptSuccess: false, tokenDecimals: 6, logs: [{ address: tokenAddress, logIndex: 1,
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", padHex(accountId.slice(5) as `0x${string}`, { size: 32 }), padHex(to as `0x${string}`, { size: 32 })],
        data: toHex(2_000_000n, { size: 32 }) }] })) });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events.every((event) => event.counterpartyAccountId === null)).toBe(true);
  });

  it("rejects an indexer page containing a proven transfer unrelated to the requested wallet", async () => {
    const from = "0x2222222222222222222222222222222222222222";
    const to = "0x3333333333333333333333333333333333333333";
    const tokenAddress = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    const transfer = { block_hash: blockHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: from }, to: { hash: to }, log_index: 1, token_type: "ERC-20", token: { address_hash: tokenAddress, decimals: "6" }, total: { value: "2000000" } };
    const proof = { blockHash, blockTimestamp: BigInt(Date.parse("2026-09-20T12:00:00.000Z") / 1000), finalized: true, receiptSuccess: true, tokenDecimals: 6,
      logs: [{ address: tokenAddress, logIndex: 1, topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef",
        padHex(from, { size: 32 }), padHex(to, { size: 32 })], data: toHex(2_000_000n, { size: 32 }) }] };
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([transfer])] }), verify: vi.fn(async () => proof) });
    expect((await source.page(request)).complete).toBe(false);
  });

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
    expect(first.events.find((item) => item.kind === "fee")?.rawDelta).toBe("-7");
    expect(JSON.parse(first.events[0].evidenceJson)).toMatchObject({ sourceEvidenceVersion: 3, providerDigest: expect.any(String), effectProof: "canonical_transaction" });
    expect(fetcher).toHaveBeenCalledTimes(4);
  });

  it("does not publish a native transfer contradicted by its canonical transaction", async () => {
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }),
      verify: vi.fn(async () => ({ ...await verified(), transaction: { ...(await verified()).transaction, value: 99n } })) });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("uses canonical receipt gas economics rather than indexed gas fields", async () => {
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }),
      verify: vi.fn(async () => ({ ...await verified(), fee: { gasUsed: 4n, effectiveGasPrice: 5n, l1Fee: 5n, operatorFee: 2n } })) });
    const result = await source.page(request);
    expect(result.complete).toBe(true);
    expect(result.events.find((event) => event.kind === "fee")?.rawDelta).toBe("-27");
    expect(JSON.parse(result.events.find((event) => event.kind === "fee")!.evidenceJson)).toMatchObject({ effectProof: "canonical_base_total_fee" });
  });

  it("keeps history incomplete when a successful native transfer lacks exact fee evidence", async () => {
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }),
      verify: vi.fn(async () => ({ ...await verified(), fee: null })) });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events.some((event) => event.kind === "fee")).toBe(false);
  });

  it("does not publish an execution-only fee when the Base L1 component is missing", async () => {
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }),
      verify: vi.fn(async () => ({ ...await verified(), fee: { gasUsed: 2n, effectiveGasPrice: 3n, operatorFee: 0n } as never })) });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events.some((event) => event.kind === "fee")).toBe(false);
  });

  it("does not treat an unverified internal trace as a native balance effect", async () => {
    const internal = { ...tx, transaction_hash: txHash, index: 7, success: true };
    const source = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([internal])], "token-transfers": [page([])] }), verify: verified });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events).toEqual([]);
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
    const roundedAmount = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([{ ...tx, value: 9007199254740993 }])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await roundedAmount.page(request)).complete).toBe(false);
    const noIndexedBlock = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([{ ...tx, block_hash: null }])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await noIndexedBlock.page(request)).complete).toBe(false);
    const changed = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([tx])], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: vi.fn(async () => ({ blockHash, finalized: false, receiptSuccess: false })) });
    expect((await changed.page(request)).complete).toBe(false);
    const token = { block_hash: `0x${"c".repeat(64)}`, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z", from: { hash: accountId.slice(5) }, to: { hash: "0x2222222222222222222222222222222222222222" }, log_index: 1, token_type: "ERC-20", token: { address_hash: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: "6" }, total: { value: "1000000" } };
    const reorg = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([token])] }), verify: verified });
    const reorgPage = await reorg.page(request);
    expect(reorgPage.complete).toBe(false);
    expect(reorgPage.events[0]?.finality).toBe("reorged");
    const partial = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [{ ...page([]), partial: true }], "internal-transactions": [page([])], "token-transfers": [page([])] }), verify: verified });
    expect((await partial.page(request)).complete).toBe(false);
    const missingPrecision = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([{ ...token, block_hash: blockHash, token: { ...token.token, decimals: null } }])] }), verify: verified });
    expect((await missingPrecision.page(request)).complete).toBe(false);
    const malformedPrecision = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [page([])], "token-transfers": [page([{ ...token, block_hash: blockHash, token: { ...token.token, decimals: "0x06" } }])] }), verify: verified });
    expect((await malformedPrecision.page(request)).complete).toBe(false);
    const badInternal = new BaseChainSource({ apiKey: "test", fetcher: chainFetch({ transactions: [page([])], "internal-transactions": [{ ...page([]), meta: { status: 0 } }], "token-transfers": [page([])] }), verify: verified });
    expect((await badInternal.page(request)).complete).toBe(false);
  });
});

describe("Base Aave source", () => {
  const reserve = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
  const market = "0xa238dd80c259a72e81d7e4664a9801593f98d1c5";
  const borrowEvent = parseAbiItem("event Borrow(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint8 interestRateMode, uint256 borrowRate, uint16 indexed referralCode)");
  const borrowLog = (overrides: Record<string, unknown> = {}) => ({
    address: market, logIndex: 1,
    topics: encodeEventTopics({ abi: [borrowEvent], eventName: "Borrow", args: { reserve, onBehalfOf: accountId.slice(5) as `0x${string}`, referralCode: 0 } }),
    data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }], [accountId.slice(5) as `0x${string}`, 3_000_000n, 2, 1n]),
    ...overrides
  });
  const activity = (overrides: Record<string, unknown> = {}) => ({ txHash, timestamp: "2026-09-20T12:00:00Z", reserve: { underlyingToken: reserve, decimals: 6 }, amount: "3", market, __typename: "Borrow", logIndex: 1, blockNumber: 100, blockHash, ...overrides });
  const proof = (overrides: Record<string, unknown> = {}) => ({ blockHash, blockTimestamp: BigInt(Date.parse("2026-09-20T12:00:00Z") / 1000), receiptSuccess: true, finalized: true, logs: [borrowLog()], ...overrides });
  it("marks ambiguous activity pagination partial", async () => {
    const source = new BaseAaveSource({ call: vi.fn(async () => ({ data: { v3: { items: [], pageInfo: {} } } })) });
    expect((await source.page(request)).complete).toBe(false);
  });

  it("finalizes a terminal Aave activity page only with verified chain evidence", async () => {
    const source = new BaseAaveSource({
      call: vi.fn(async () => ({ data: { v3: { items: [activity()], pageInfo: { hasNextPage: false } } } })),
      verify: vi.fn(async () => proof())
    });
    const result = await source.page(request);
    expect(result.complete).toBe(true);
    expect(result.events[0]).toMatchObject({ kind: "borrow", rawDelta: "-3000000", finality: "finalized" });
    expect(result.events[0].ingestionVersion).toBe(3);
    expect(JSON.parse(result.events[0].evidenceJson)).toMatchObject({ sourceEvidenceVersion: 3, effectProof: "canonical_aave_pool_log" });
  });

  it("does not complete a window when an in-window Pool event is indexed outside it", async () => {
    const verify = vi.fn(async () => proof());
    const source = new BaseAaveSource({
      call: vi.fn(async () => ({ data: { v3: { items: [activity({ timestamp: "2026-09-19T12:00:00Z" })], pageInfo: { hasNextPage: false } } } })),
      verify
    });
    const result = await source.page(request);
    expect(verify).toHaveBeenCalledOnce();
    expect(result.complete).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("rejects successful receipts without an exact governed Pool event", async () => {
    for (const bad of [
      proof({ logs: [] }),
      proof({ logs: [borrowLog({ address: "0x2222222222222222222222222222222222222222" })] }),
      proof({ logs: [borrowLog({ logIndex: 2 })] }),
      proof({ logs: [borrowLog({ data: encodeAbiParameters([{ type: "address" }, { type: "uint256" }, { type: "uint8" }, { type: "uint256" }], [accountId.slice(5) as `0x${string}`, 2_000_000n, 2, 1n]) })] }),
      proof({ logs: [borrowLog({ topics: encodeEventTopics({ abi: [borrowEvent], eventName: "Borrow", args: { reserve, onBehalfOf: "0x2222222222222222222222222222222222222222", referralCode: 0 } }) })] }),
      proof({ blockTimestamp: 1n })
    ]) {
      const source = new BaseAaveSource({ call: vi.fn(async () => ({ data: { v3: { items: [activity()], pageInfo: { hasNextPage: false } } } })), verify: vi.fn(async () => bad) });
      const result = await source.page(request);
      expect(result.complete).toBe(false);
      expect(result.events).toEqual([]);
    }
  });

  it("returns an incomplete page for a fractional provider timestamp", async () => {
    const source = new BaseAaveSource({ call: vi.fn(async () => ({ data: { v3: { items: [activity({ timestamp: "2026-09-20T12:00:00.123Z" })], pageInfo: { hasNextPage: false } } } })),
      verify: vi.fn(async () => proof()) });
    const result = await source.page(request);
    expect(result.complete).toBe(false);
    expect(result.events).toEqual([]);
  });

  it("matches each supported position effect to its account role and raw amount", async () => {
    const wallet = accountId.slice(5) as `0x${string}`;
    const other = "0x2222222222222222222222222222222222222222" as const;
    const cases = [
      { type: "Supply", kind: "supply", signature: "event Supply(address indexed reserve, address user, address indexed onBehalfOf, uint256 amount, uint16 indexed referralCode)",
        indexed: { reserve, onBehalfOf: wallet, referralCode: 0 }, fields: [{ type: "address" }, { type: "uint256" }], values: [other, 3_000_000n], delta: "3000000" },
      { type: "Withdraw", kind: "redeem", signature: "event Withdraw(address indexed reserve, address indexed user, address indexed to, uint256 amount)",
        indexed: { reserve, user: wallet, to: other }, fields: [{ type: "uint256" }], values: [3_000_000n], delta: "-3000000" },
      { type: "Repay", kind: "repay", signature: "event Repay(address indexed reserve, address indexed user, address indexed repayer, uint256 amount, bool useATokens)",
        indexed: { reserve, user: wallet, repayer: other }, fields: [{ type: "uint256" }, { type: "bool" }], values: [3_000_000n, false], delta: "3000000" }
    ] as const;
    for (const item of cases) {
      const event = parseAbiItem(item.signature);
      const log = { address: market, logIndex: 1, topics: encodeEventTopics({ abi: [event], eventName: item.type, args: item.indexed }),
        data: encodeAbiParameters(item.fields, item.values) };
      const source = new BaseAaveSource({ call: vi.fn(async () => ({ data: { v3: { items: [activity({ __typename: item.type })], pageInfo: { hasNextPage: false } } } })),
        verify: vi.fn(async () => proof({ logs: [log] })) });
      const result = await source.page(request);
      expect(result.complete).toBe(true);
      expect(result.events[0]).toMatchObject({ kind: item.kind, rawDelta: item.delta });
    }
  });

  it("uses distinct source event identities for two linked wallets in one transaction", async () => {
    const call = vi.fn(async () => ({ data: { v3: { items: [activity()], pageInfo: { hasNextPage: false } } } }));
    const source = new BaseAaveSource({ call, verify: vi.fn(async () => proof()) });
    const first = await source.page(request);
    const second = await source.page({ ...request, accountId: "8453:0x2222222222222222222222222222222222222222" });
    expect(first.events).toHaveLength(1);
    expect(second.complete).toBe(false);
  });

  it("excludes activity outside the requested coverage window", async () => {
    const verify = vi.fn(async () => proof({
      blockTimestamp: BigInt(Date.parse("2026-09-19T12:00:00Z") / 1000)
    }));
    const source = new BaseAaveSource({
      call: vi.fn(async () => ({ data: { v3: { items: [activity({ timestamp: "2026-09-19T12:00:00Z" })], pageInfo: { hasNextPage: false } } } })), verify
    });
    const result = await source.page(request);
    expect(result.complete).toBe(true);
    expect(result.events).toEqual([]);
    expect(verify).toHaveBeenCalledTimes(1);
  });
});
