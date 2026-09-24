import { describe, expect, it, vi } from "vitest";
import { decodeFunctionData, encodeFunctionResult, parseAbi } from "viem";
import { readHistoricalAaveLegs } from "@/lib/portfolio/aave-history-positions";

const account = `8453:0x${"b".repeat(40)}` as const;
const asset = `0x${"c".repeat(40)}`;
const pool = `0x${"d".repeat(40)}`;
const provider = `0x${"e".repeat(40)}`;
const midnight = BigInt(Date.parse("2026-09-23T00:00:00Z") / 1000);
const hash = (number: bigint) => `0x${number.toString(16).padStart(64, "0")}`;
const abi = parseAbi([
  "function getUserReserveData(address asset,address user) view returns (uint256,uint256,uint256,uint256,uint256,uint256,uint256,uint40,bool)",
  "function getReserveConfigurationData(address asset) view returns (uint256,uint256,uint256,uint256,uint256,bool,bool,bool,bool,bool)"
]);

function chain(options: { empty?: boolean; failed?: boolean; reorg?: boolean; noCode?: boolean; archiveFailure?: boolean } = {}) {
  const reads: Array<Record<string, unknown>> = [];
  const client = {
    getChainId: vi.fn(async () => 8453),
    getBlockNumber: vi.fn(async () => 100n),
    getBlock: vi.fn(async ({ blockNumber }: { blockNumber: bigint }) => ({ number: blockNumber,
      hash: options.reorg && blockNumber === 49n && client.getBlock.mock.calls.filter(([input]) => input.blockNumber === 49n).length > 2 ? hash(149n) : hash(blockNumber),
      timestamp: blockNumber < 50n ? midnight - (50n - blockNumber) : midnight + (blockNumber - 50n) })),
    getBytecode: vi.fn(async () => options.noCode ? undefined : "0x1234"),
    readContract: vi.fn(async (input: Record<string, unknown>) => {
      reads.push(input);
      if (options.archiveFailure) throw new Error("missing archive state");
      switch (input.functionName) {
        case "getPool": return pool;
        case "getPoolDataProvider": return provider;
        case "getReservesList": return [asset];
        case "aggregate3": return (input.args as Array<Array<{ target: string; callData: `0x${string}` }>>)[0].map((call) => {
          const decoded = decodeFunctionData({ abi, data: call.callData });
          if (options.failed) return { success: false, returnData: "0x" };
          return decoded.functionName === "getUserReserveData"
            ? { success: true, returnData: encodeFunctionResult({ abi, functionName: "getUserReserveData", result: options.empty
              ? [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0, false]
              : [10_000_000n, 1_000_000n, 2_000_000n, 0n, 0n, 0n, 0n, 0, true] }) }
            : { success: true, returnData: encodeFunctionResult({ abi, functionName: "getReserveConfigurationData", result: [6n, 0n, 0n, 0n, 0n, false, true, false, true, false] }) };
        });
        default: throw new Error("unexpected read");
      }
    })
  };
  return { client, reads };
}

describe("historical Aave raw position evidence", () => {
  it("refuses an unconfigured or insecure archive source without making a network call", async () => {
    const fetch = vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("unexpected network"));
    try {
      for (const archiveUrl of ["", "http://example.test/archive", "not-a-url", "https://bad host"]) {
        vi.stubEnv("AUREL_BASE_ARCHIVE_RPC_URL", archiveUrl);
        const result = await readHistoricalAaveLegs(account, "2026-09-22", { now: new Date("2026-09-24") });
        expect(result).toMatchObject({ status: "unavailable", reason: "archive_unconfigured", legs: [] });
      }
      expect(fetch).not.toHaveBeenCalled();
    } finally { vi.unstubAllEnvs(); fetch.mockRestore(); }
  });

  it("uses historical registered contracts and hash-pinned batches for supply and both debts", async () => {
    const { client, reads } = chain();
    const result = await readHistoricalAaveLegs(account, "2026-09-22", { client: client as never, now: new Date("2026-09-24") });
    expect(result).toMatchObject({ status: "complete", blockNumber: "49", blockHash: hash(49n), pool, dataProvider: provider,
      legs: [{ assetId: `8453:${asset}`, side: "supply", rawUnits: "10000000", decimals: 6 },
        { assetId: `8453:${asset}`, side: "debt", rawUnits: "-3000000", decimals: 6 }] });
    expect(reads.every((read) => read.blockHash === hash(49n) && read.requireCanonical === true)).toBe(true);
    const batches = reads.filter((read) => read.functionName === "aggregate3");
    expect(batches).toHaveLength(2);
    expect(((batches[0].args as Array<Array<{ target: string }>>)[0])[0].target).toBe(provider);
  });

  it("proves zero only with complete coverage and rejects failed or missing evidence", async () => {
    const zero = chain({ empty: true });
    expect(await readHistoricalAaveLegs(account, "2026-09-22", { client: zero.client as never, now: new Date("2026-09-24") })).toMatchObject({ status: "complete", legs: [] });
    for (const options of [{ failed: true }, { noCode: true }, { archiveFailure: true }, { reorg: true }]) {
      const { client } = chain(options);
      const result = await readHistoricalAaveLegs(account, "2026-09-22", { client: client as never, now: new Date("2026-09-24") });
      expect(result.status).toBe("unavailable");
      expect(result.legs).toEqual([]);
    }
  });
});
