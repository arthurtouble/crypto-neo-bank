import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { readCurrentAaveLegs } from "@/lib/portfolio/aave-source";

const accountId = `8453:0x${"b".repeat(40)}` as const;
const usdc = "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const weth = "0x4200000000000000000000000000000000000006";
const blockHash = `0x${"a".repeat(64)}`;
const block = { number: 80n, hash: blockHash, timestamp: 1_000_000n };
const reserveAbi = parseAbi(["function getUserReserveData(address asset,address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)"]);
const configurationAbi = parseAbi(["function getReserveConfigurationData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)"]);
const batchAbi = [...reserveAbi, ...configurationAbi];

function chain(overrides: { reserves?: unknown; positions?: Record<string, unknown>; configuration?: unknown; reorg?: boolean; wrongBlock?: boolean; fail?: boolean; batchFailure?: boolean; configurationBatchFailure?: boolean; malformedBatch?: boolean; onRead?: (functionName: string) => void } = {}) {
  const reads: Array<{ address?: string; functionName: string; args?: readonly unknown[]; blockHash?: string; requireCanonical?: boolean }> = [];
  const client = {
    getChainId: vi.fn(async () => 8453),
    getBlockNumber: vi.fn(async () => 100n),
    getBlock: vi.fn(async () => overrides.reorg && client.getBlock.mock.calls.length > 1 ? { ...block, hash: `0x${"c".repeat(64)}` }
      : overrides.wrongBlock ? { ...block, number: 79n } : block),
    readContract: vi.fn(async (request: { address?: string; functionName: string; args?: readonly unknown[]; blockHash?: string; requireCanonical?: boolean }) => {
      reads.push(request);
      overrides.onRead?.(request.functionName);
      if (overrides.fail) throw new Error("RPC unavailable");
      switch (request.functionName) {
        case "getPool": return "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5";
        case "getPoolDataProvider": return "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A";
        case "getReservesList": return overrides.reserves ?? [usdc, weth];
        case "aggregate3": return (request.args?.[0] as Array<{ callData: `0x${string}` }>).map((call, index) => {
          const decoded = decodeFunctionData({ abi: batchAbi, data: call.callData });
          const asset = String(decoded.args?.[0]).toLowerCase();
          if (decoded.functionName === "getReserveConfigurationData") return overrides.configurationBatchFailure && index === 0
            ? { success: false, returnData: "0x" }
            : { success: true, returnData: encodeFunctionResult({ abi: configurationAbi, functionName: "getReserveConfigurationData", result: (overrides.configuration ?? [6n, 0n, 0n, 0n, 0n, false, true, false, true, false]) as never }) };
          const position = overrides.positions?.[asset] ?? [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false];
          return overrides.batchFailure && index === 1 ? { success: false, returnData: "0x" }
            : overrides.malformedBatch && index === 1 ? { success: true, returnData: "0x" }
            : { success: true, returnData: encodeFunctionResult({ abi: reserveAbi, functionName: "getUserReserveData", result: position as never }) };
        });
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
    expect(reads.filter((read) => read.functionName === "aggregate3")).toHaveLength(2);
    expect(reads.filter((read) => read.functionName === "getUserReserveData")).toHaveLength(0);
    expect(reads.filter((read) => read.functionName === "getReserveConfigurationData")).toHaveLength(0);
    const batches = reads.filter((read) => read.functionName === "aggregate3");
    expect(batches.every((read) => read.address?.toLowerCase() === "0xca11bde05977b3631167028862be2a173976ca11")).toBe(true);
    const firstCalls = batches[0].args?.[0] as Array<{ target: string; allowFailure: boolean; callData: `0x${string}` }>;
    expect(firstCalls).toHaveLength(2);
    expect(firstCalls.every((call) => call.target.toLowerCase() === "0x0f43731eb8d45a581f4a36dd74f5f358bc90c73a" && call.allowFailure)).toBe(true);
    expect(firstCalls.map((call) => decodeFunctionData({ abi: reserveAbi, data: call.callData }).args?.map((value) => String(value).toLowerCase()))).toEqual([[usdc, accountId.slice(5)], [weth, accountId.slice(5)]]);
    expect(reads.every((read) => read.blockHash === blockHash && read.requireCanonical === true)).toBe(true);
  });

  it("proves an empty position only after scanning the full reserve list", async () => {
    const { client, reads } = chain();
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result).toMatchObject({ status: "complete", legs: [] });
    expect(reads.filter((read) => read.functionName === "aggregate3")).toHaveLength(1);
    expect(reads.filter((read) => read.functionName === "getUserReserveData")).toHaveLength(0);
  });

  it("fails closed if one reserve call in the canonical batch fails", async () => {
    const { client } = chain({ batchFailure: true });
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result.status).not.toBe("complete");
    expect(result.legs).toEqual([]);
  });

  it("fails closed if an active reserve configuration batch fails", async () => {
    const { client } = chain({ positions: { [usdc]: [1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, true] }, configurationBatchFailure: true });
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result.status).not.toBe("complete");
    expect(result.legs).toEqual([]);
  });

  it("reads every active reserve configuration in one pinned second batch", async () => {
    const { client, reads } = chain({ positions: {
      [usdc]: [1n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, true],
      [weth]: [0n, 0n, 2n, 0n, 0n, 0n, 0n, 0n, true]
    } });
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result).toMatchObject({ status: "complete", legs: [{ assetId: `8453:${usdc}`, side: "supply" }, { assetId: `8453:${weth}`, side: "debt" }] });
    const batches = reads.filter((read) => read.functionName === "aggregate3");
    expect(batches).toHaveLength(2);
    expect(batches[1].blockHash).toBe(blockHash);
    const configCalls = batches[1].args?.[0] as Array<{ target: string; allowFailure: boolean; callData: `0x${string}` }>;
    expect(configCalls).toHaveLength(2);
    expect(configCalls.every((call) => call.target.toLowerCase() === "0x0f43731eb8d45a581f4a36dd74f5f358bc90c73a" && call.allowFailure)).toBe(true);
    expect(configCalls.map((call) => String(decodeFunctionData({ abi: configurationAbi, data: call.callData }).args?.[0]).toLowerCase())).toEqual([usdc, weth]);
    expect(reads.some((read) => read.functionName === "getReserveConfigurationData")).toBe(false);
  });

  it("fails closed on malformed data inside an otherwise successful reserve batch", async () => {
    const { client } = chain({ malformedBatch: true });
    const result = await readCurrentAaveLegs(accountId, { client: client as never, now: new Date(1_000_002_000) } as never);
    expect(result.status).not.toBe("complete");
    expect(result.legs).toEqual([]);
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
        if (name === "aggregate3") vi.setSystemTime(new Date(1_000_310_000));
      } });
      const result = await readCurrentAaveLegs(accountId, { client: client as never });
      expect(result.status).not.toBe("complete");
      expect(result.legs).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
});
