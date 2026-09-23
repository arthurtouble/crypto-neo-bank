import { describe, expect, it, vi } from "vitest";
import { padHex, toHex } from "viem";

const rpc = vi.hoisted(() => ({
  getTransactionReceipt: vi.fn(), getBlock: vi.fn(), getBlockNumber: vi.fn(), readContract: vi.fn()
}));
vi.mock("viem", async (importOriginal) => ({
  ...await importOriginal<typeof import("viem")>(),
  createPublicClient: () => rpc
}));

import { BaseChainSource } from "@/lib/portfolio/chain-source";

describe("canonical Base portfolio effects", () => {
  it("reports a changed indexed block even when token metadata is unreadable", async () => {
    const txHash = `0x${"a".repeat(64)}`;
    const canonicalHash = `0x${"b".repeat(64)}`;
    const indexedHash = `0x${"c".repeat(64)}`;
    const wallet = "0x1111111111111111111111111111111111111111";
    rpc.getTransactionReceipt.mockResolvedValue({ status: "success", blockHash: canonicalHash, blockNumber: 100n, transactionHash: txHash, logs: [] });
    rpc.getBlock.mockResolvedValue({ hash: canonicalHash });
    rpc.getBlockNumber.mockResolvedValue(200n);
    rpc.readContract.mockRejectedValue(new Error("historical contract unavailable"));
    const item = { block_hash: indexedHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: wallet }, to: { hash: "0x2222222222222222222222222222222222222222" }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: "6" }, total: { value: "2000000" } };
    const fetcher = vi.fn(async (url: string) => Response.json({ items: new URL(url).pathname.endsWith("/token-transfers") ? [item] : [], next_page_params: null,
      ...(new URL(url).pathname.endsWith("/internal-transactions") ? { meta: { status: 1 } } : {}) }));
    const result = await new BaseChainSource({ apiKey: "test", fetcher }).page({ accountId: `8453:${wallet}`, cursor: null,
      from: "2026-09-20T00:00:00.000Z", through: "2026-09-21T00:00:00.000Z", limit: 10 });
    expect(result.complete).toBe(false);
    expect(result.events[0]).toMatchObject({ finality: "reorged", blockHash: canonicalHash });
  });

  it("invalidates a dropped transaction when its former block has changed", async () => {
    const txHash = `0x${"a".repeat(64)}`;
    const canonicalHash = `0x${"b".repeat(64)}`;
    const indexedHash = `0x${"c".repeat(64)}`;
    const wallet = "0x1111111111111111111111111111111111111111";
    rpc.getTransactionReceipt.mockRejectedValue(new Error("transaction not found"));
    rpc.getBlock.mockResolvedValue({ hash: canonicalHash, timestamp: BigInt(Date.parse("2026-09-20T12:00:00.000Z") / 1000) });
    rpc.getBlockNumber.mockResolvedValue(200n);
    const item = { block_hash: indexedHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-20T12:00:00Z",
      from: { hash: wallet }, to: { hash: "0x2222222222222222222222222222222222222222" }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", decimals: "6" }, total: { value: "2000000" } };
    const fetcher = vi.fn(async (url: string) => Response.json({ items: new URL(url).pathname.endsWith("/token-transfers") ? [item] : [], next_page_params: null,
      ...(new URL(url).pathname.endsWith("/internal-transactions") ? { meta: { status: 1 } } : {}) }));
    const result = await new BaseChainSource({ apiKey: "test", fetcher }).page({ accountId: `8453:${wallet}`, cursor: null,
      from: "2026-09-20T00:00:00.000Z", through: "2026-09-21T00:00:00.000Z", limit: 10 });
    expect(result.complete).toBe(false);
    expect(result.events[0]).toMatchObject({ finality: "reorged", blockHash: canonicalHash });
  });

  it("uses the canonical block time when the indexer gives a different transfer day", async () => {
    const txHash = `0x${"d".repeat(64)}`;
    const blockHash = `0x${"e".repeat(64)}`;
    const wallet = "0x1111111111111111111111111111111111111111";
    const to = "0x2222222222222222222222222222222222222222";
    const token = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
    rpc.getTransactionReceipt.mockResolvedValue({ status: "success", blockHash, blockNumber: 100n, transactionHash: txHash, transactionIndex: 3,
      logs: [{ address: token, logIndex: 1,
        topics: ["0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef", padHex(wallet, { size: 32 }), padHex(to, { size: 32 })],
        data: toHex(2_000_000n, { size: 32 }) }] });
    rpc.getBlock.mockResolvedValue({ hash: blockHash, timestamp: BigInt(Date.parse("2026-09-20T12:00:00.000Z") / 1000) });
    rpc.getBlockNumber.mockResolvedValue(200n);
    rpc.readContract.mockResolvedValue(6);
    const item = { block_hash: blockHash, block_number: 100, transaction_hash: txHash, timestamp: "2026-09-19T12:00:00Z",
      from: { hash: wallet }, to: { hash: to }, log_index: 1, token_type: "ERC-20",
      token: { address_hash: token, decimals: "6" }, total: { value: "2000000" } };
    const fetcher = vi.fn(async (url: string) => Response.json({ items: new URL(url).pathname.endsWith("/token-transfers") ? [item] : [], next_page_params: null,
      ...(new URL(url).pathname.endsWith("/internal-transactions") ? { meta: { status: 1 } } : {}) }));
    const result = await new BaseChainSource({ apiKey: "test", fetcher }).page({ accountId: `8453:${wallet}`, cursor: null,
      from: "2026-09-20T00:00:00.000Z", through: "2026-09-21T00:00:00.000Z", limit: 10 });
    expect(result.complete).toBe(true);
    expect(result.events[0]).toMatchObject({ occurredAt: "2026-09-20T12:00:00.000Z", rawDelta: "-2000000", counterpartyAccountId: `8453:${to}` });
    expect(JSON.parse(result.events[0].evidenceJson)).toMatchObject({ transactionIndex: 3 });
  });
});
