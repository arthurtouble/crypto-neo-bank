import { describe, expect, it, vi } from "vitest";
import { readCurrentAaveLegs } from "@/lib/portfolio/aave-source";

const accountId = `8453:0x${"b".repeat(40)}` as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const weth = "0x4200000000000000000000000000000000000006";
const blockHash = `0x${"a".repeat(64)}`;
const block = { number: 80n, hash: blockHash, timestamp: 1_000_000n };

function chain(overrides: { reserves?: unknown; positions?: Record<string, unknown>; configuration?: unknown; reorg?: boolean; wrongBlock?: boolean; fail?: boolean; onRead?: (functionName: string) => void } = {}) {
  const reads: Array<{ functionName: string; blockHash?: string; requireCanonical?: boolean }> = [];
  const client = {
    getChainId: vi.fn(async () => 8453),
    getBlockNumber: vi.fn(async () => 100n),
    getBlock: vi.fn(async () => overrides.reorg && client.getBlock.mock.calls.length > 1 ? { ...block, hash: `0x${"c".repeat(64)}` }
      : overrides.wrongBlock ? { ...block, number: 79n } : block),
    readContract: vi.fn(async (request: { functionName: string; args?: readonly unknown[]; blockHash?: string; requireCanonical?: boolean }) => {
      reads.push(request);
      overrides.onRead?.(request.functionName);
      if (overrides.fail) throw new Error("RPC unavailable");
      switch (request.functionName) {
        case "getPool": return "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
        case "getPoolDataProvider": return "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A";
        case "getReservesList": return overrides.reserves ?? [usdc, weth];
        case "getUserReserveData": return overrides.positions?.[String(request.args?.[0]).toLowerCase()] ?? [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false];
        case "getReserveConfigurationData": return overrides.configuration ?? [6n, 0n, 0n, 0n, 0n, false, true, false, true, false];
        default: throw new Error(`Unexpected ${request.functionName}`);
      }
    })
  };
  return { client, reads };
}

describe("canonical current Aave portfolio legs", () => {
  it("reads every reserve at one confirmed canonical block and includes accrued supply and both debt modes", async () => {
    const { client, reads } = chain({ positions: { [usdc]: [10_000_000n, 1_000_000n, 2_000_000n, 0n, 0n, 0n, 0n, 0n, true] } });
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result).toMatchObject({ status: "complete", reason: null, legs: [
      { assetId: `8453:${usdc}`, side: "supply", rawUnits: "10000000", observedAt: "1970-01-12T13:46:40.000Z" },
      { assetId: `8453:${usdc}`, side: "debt", rawUnits: "-3000000", observedAt: "1970-01-12T13:46:40.000Z" }
    ] });
    expect(reads.filter((read) => read.functionName === "getUserReserveData")).toHaveLength(2);
    expect(reads.every((read) => read.blockHash === blockHash && read.requireCanonical === true)).toBe(true);
  });

  it("proves an empty position only after scanning the full reserve list", async () => {
    const { client, reads } = chain();
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result).toMatchObject({ status: "complete", legs: [] });
    expect(reads.filter((read) => read.functionName === "getUserReserveData")).toHaveLength(2);
  });

  it("fails closed on incomplete reserve coverage, changed block, and RPC failure", async () => {
    for (const options of [{ reserves: [] }, { reserves: [`0x${"0".repeat(40)}`] }, { reorg: true }, { wrongBlock: true }, { fail: true },
      { positions: { [usdc]: [1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false] }, configuration: [null] }]) {
      const { client } = chain(options);
      const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
      expect(result.status).not.toBe("complete");
      expect(result.legs).toEqual([]);
    }
  });

  it("logs a bounded failure stage without exposing the account address", async () => {
    const logged = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    try {
      const { client } = chain({ fail: true });
      const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
      expect(result.status).toBe("unavailable");
      const event = JSON.parse(String(logged.mock.calls.at(-1)?.[0])) as Record<string, unknown>;
      expect(event).toMatchObject({ event: "portfolio.aave.current.failed", stage: "market", errorName: "Error" });
      expect(JSON.stringify(event)).not.toContain(accountId.slice(5));
    } finally { logged.mockRestore(); }
  });

  it("does not call an unsupported account or wrong chain a complete zero", async () => {
    const wrong = chain();
    wrong.client.getChainId.mockResolvedValueOnce(1);
    expect((await readCurrentAaveLegs(accountId, { client: wrong.client as never } as never)).status).not.toBe("complete");
    expect((await readCurrentAaveLegs("1:0x" + "b".repeat(40) as never, { client: chain().client as never } as never)).status).toBe("unavailable");
  });

  it("does not return complete when the reserve scan outlives snapshot freshness", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date(1_000_002_000));
      const { client } = chain({ onRead: (name) => {
        if (name === "getUserReserveData") vi.setSystemTime(new Date(1_000_310_000));
      } });
      const result = await readCurrentAaveLegs(accountId, { client: client as never });
      expect(result.status).not.toBe("complete");
      expect(result.legs).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
