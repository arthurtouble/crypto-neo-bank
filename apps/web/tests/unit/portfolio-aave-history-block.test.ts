import { describe, expect, it, vi } from "vitest";
import { resolveHistoricalAaveBlock, verifyHistoricalAaveBlock } from "@/lib/portfolio/aave-history";

const midnight = BigInt(Date.parse("2026-09-23T00:00:00.000Z") / 1000);
const hash = (number: bigint) => `0x${number.toString(16).padStart(64, "0")}`;

function chain(options: { tip?: bigint; changed?: boolean; missing?: bigint; chainId?: number } = {}) {
  const client = {
    getChainId: vi.fn(async () => options.chainId ?? 8453),
    getBlockNumber: vi.fn(async () => options.tip ?? 100n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => {
      if (blockNumber === options.missing) throw new Error("archive missing");
      const timestamp = blockNumber < 50n ? midnight - (50n - blockNumber) : midnight + (blockNumber - 50n);
      return { number: blockNumber, hash: options.changed && blockNumber === 49n && client.getBlock.mock.calls.filter(([input]) => input.blockNumber === 49n).length > 1 ? hash(149n) : hash(blockNumber), timestamp };
    })
  };
  return client;
}

describe("historical Aave day-end block evidence", () => {
  it("brackets UTC midnight with the last finalized block and its successor", async () => {
    const client = chain();
    const result = await resolveHistoricalAaveBlock("2026-09-22", { client: client as never, now: new Date("2026-09-24T00:00:00Z") });
    expect(result).toMatchObject({ status: "complete", block: { number: 49n, hash: hash(49n), timestamp: midnight - 1n }, successor: { number: 50n, hash: hash(50n), timestamp: midnight } });
    expect(client.getBlock.mock.calls.length).toBeLessThan(30);
    expect(await verifyHistoricalAaveBlock(result, client as never)).toBe(true);
  });

  it("rejects malformed, current, future, and unsupported-chain requests", async () => {
    const client = chain();
    for (const day of ["2026-09-23", "2026-09-24", "2026-02-30", "2026-9-22", "2026-09-22T00:00:00Z"]) {
      expect((await resolveHistoricalAaveBlock(day, { client: client as never, now: new Date("2026-09-23T12:00:00Z") })).status).toBe("unavailable");
    }
    expect((await resolveHistoricalAaveBlock("2026-09-22", { client: chain({ chainId: 1 }) as never, now: new Date("2026-09-24") })).status).toBe("unavailable");
  });

  it("does not treat unfinalized midnight or missing archive evidence as a complete day", async () => {
    for (const client of [chain({ tip: 69n }), chain({ missing: 49n })]) {
      const result = await resolveHistoricalAaveBlock("2026-09-22", { client: client as never, now: new Date("2026-09-24"), confirmationDepth: 20n });
      expect(result.status).toBe("unavailable");
    }
  });

  it("detects a changed selected block on verification", async () => {
    const client = chain();
    const result = await resolveHistoricalAaveBlock("2026-09-22", { client: client as never, now: new Date("2026-09-24") });
    expect(result.status).toBe("complete");
    const original = client.getBlock.getMockImplementation()!;
    client.getBlock.mockImplementation(async (input) => input.blockNumber === 49n
      ? { number: 49n, hash: hash(149n), timestamp: midnight - 1n }
      : original(input));
    expect(await verifyHistoricalAaveBlock(result, client as never)).toBe(false);
  });

  it("rejects conflicting timestamps among observed archive blocks", async () => {
    const client = chain();
    const original = client.getBlock.getMockImplementation()!;
    client.getBlock.mockImplementation(async (input) => input.blockNumber === 60n
      ? { number: 60n, hash: hash(60n), timestamp: midnight + 100n }
      : original(input));
    const result = await resolveHistoricalAaveBlock("2026-09-22", { client: client as never, now: new Date("2026-09-24") });
    expect(result.status).toBe("unavailable");
  });
});
