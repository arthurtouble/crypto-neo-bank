import { describe, expect, it, vi } from "vitest";
import { readAaveBaseRiskSnapshot } from "@/lib/defi/aave-risk-snapshot";
import { assessAaveActionRisk } from "@/lib/defi/aave-risk-gate";

const blockHash = `0x${"a".repeat(64)}`;
const user = `0x${"b".repeat(40)}`;
const asset = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913";
const other = `0x${"c".repeat(40)}`;
const token = `0x${"d".repeat(40)}`;
const block = { number: 42n, hash: blockHash, timestamp: 1_000_000n };

function mockClient(overrides: Record<string, unknown> = {}) {
  const calls: Array<{ functionName: string; blockHash: string; requireCanonical: boolean; blockNumber?: bigint; args?: readonly unknown[] }> = [];
  const values: Record<string, unknown> = {
    getPool: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
    getPriceOracle: "0x2Cc0Fc26eD4563A5ce5e8bdcfe1A2878676Ae156",
    getPoolDataProvider: "0x0F43731EB8d45A581f4a36DD74F5f358bc90C73A",
    getReservesList: [asset, other],
    getUserAccountData: [200_000_000_000n, 100_000_000_000n, 50_000_000_000n, 8_000n, 7_000n, 1_600_000_000_000_000_000n],
    getUserEMode: 0n,
    getReserveConfigurationData: [6n, 8_000n, 8_000n, 10_500n, 1_000n, true, true, false, true, false],
    getReserveCaps: [1_000n, 2_000n],
    getPaused: false,
    getReserveData: [0n, 0n, 500_000_000n, 0n, 100_000_000n, 0n, 0n, 0n, 0n, 10n ** 27n, 10n ** 27n, 0n],
    getReserveNormalizedIncome: 10n ** 27n,
    getReserveNormalizedVariableDebt: 10n ** 27n,
    getReserveTokensAddresses: [token, `0x${"e".repeat(40)}`, `0x${"f".repeat(40)}`],
    getAssetPrice: 100_000_000n,
    BASE_CURRENCY_UNIT: 100_000_000n,
    balanceOf: 400_000_000n,
    getDebtCeiling: 0n,
    ...overrides
  };
  const client = {
    getChainId: vi.fn(async () => 8453),
    getBlock: vi.fn(async () => block),
    readContract: vi.fn(async ({ functionName, blockHash, requireCanonical, blockNumber, args }: {
      functionName: string; blockHash: string; requireCanonical: boolean; blockNumber?: bigint; args?: readonly unknown[]
    }) => {
      calls.push({ functionName, blockHash, requireCanonical, blockNumber, args });
      if (functionName === "getUserReserveData" && Object.hasOwn(overrides, "getUserReserveData")) return values.getUserReserveData;
      if (functionName === "getUserReserveData") return args?.[0] === asset
        ? [200_000_000n, 0n, 100_000_000n, 0n, 100_000_000n, 0n, 0n, 0n, true]
        : [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false];
      return values[functionName];
    })
  };
  return { client, calls };
}

const request = { user, asset, action: "borrow" as const, amountRaw: 1_000_000n,
  nowMs: 1_000_002_000, maxAgeMs: 30_000, minHealthFactorWad: 1_250_000_000_000_000_000n };

describe("read-only Aave Base risk snapshot", () => {
  it("builds a complete risk input from one canonical block and scans every reserve for raw debt", async () => {
    const { client, calls } = mockClient();
    const input = await readAaveBaseRiskSnapshot(client as never, request);
    expect(input.snapshot).toEqual({ blockNumber: 42n, blockHash, observedAtMs: 1_000_000_000, complete: true });
    expect(input.account).toMatchObject({ allDebtAbsentProven: false, variableDebtRaw: 100_000_000n,
      assetCollateralBalanceRaw: 200_000_000n, isolationMode: false, eModeCategory: 0,
      weightedCollateralBase: 160_000_000_000n });
    expect(input.reserve).toMatchObject({ priceBase: 100_000_000n, availableLiquidityRaw: 400_000_000n,
      supplyCapRemainingRaw: 1_499_999_997n, borrowCapRemainingRaw: 899_999_997n });
    expect(calls.filter((call) => call.functionName === "getUserReserveData")).toHaveLength(2);
    expect(calls.every((call) => call.blockHash === blockHash && call.requireCanonical === true && call.blockNumber === undefined)).toBe(true);
    expect(client.getBlock).toHaveBeenCalledTimes(2);
  });

  it("does not infer no debt from a rounded-zero account aggregate", async () => {
    const { client } = mockClient({ getUserAccountData: [0n, 0n, 0n, 0n, 0n, 0n],
      getUserReserveData: [0n, 0n, 1n, 0n, 1n, 0n, 0n, 0n, false] });
    await expect(readAaveBaseRiskSnapshot(client as never, request)).rejects.toThrow(/debt|inconsistent/i);
  });

  it("proves debt absence only after every reserve has a zero raw debt read", async () => {
    const { client } = mockClient({ getUserAccountData: [0n, 0n, 0n, 0n, 0n, 0n],
      getUserReserveData: [0n, 0n, 0n, 0n, 0n, 0n, 0n, 0n, false] });
    const input = await readAaveBaseRiskSnapshot(client as never, request);
    expect(input.account.allDebtAbsentProven).toBe(true);
    expect(input.account.debtBase).toBe(0n);
  });

  it("uses current normalized indices for unminted treasury and cap rounding", async () => {
    const data = [0n, 10n, 500_000_000n, 0n, 100_000_000n, 0n, 0n, 0n, 0n,
      10n ** 27n, 10n ** 27n, 0n];
    const { client } = mockClient({ getReserveData: data, getReserveNormalizedIncome: 2n * 10n ** 27n,
      getReserveNormalizedVariableDebt: 2n * 10n ** 27n });
    const input = await readAaveBaseRiskSnapshot(client as never, request);
    expect(input.reserve.supplyCapRemainingRaw).toBe(1_499_999_974n);
    expect(input.reserve.borrowCapRemainingRaw).toBe(899_999_994n);
  });

  it("does not double-count unbacked aTokens already included in total supply", async () => {
    const data = [100_000_000n, 0n, 500_000_000n, 0n, 100_000_000n, 0n, 0n, 0n, 0n,
      10n ** 27n, 10n ** 27n, 0n];
    const { client } = mockClient({ getReserveData: data });
    const input = await readAaveBaseRiskSnapshot(client as never, request);
    expect(input.reserve.supplyCapRemainingRaw).toBe(1_499_999_997n);
  });

  it("rejects a governance change to the active oracle or data provider", async () => {
    for (const change of [{ getPriceOracle: other }, { getPoolDataProvider: other }]) {
      const { client } = mockClient(change);
      await expect(readAaveBaseRiskSnapshot(client as never, request)).rejects.toThrow(/oracle|provider/i);
    }
  });

  it("rejects incomplete reserve coverage and reorged blocks", async () => {
    const missing = mockClient({ getUserReserveData: undefined });
    await expect(readAaveBaseRiskSnapshot(missing.client as never, request)).rejects.toThrow();
    const reorg = mockClient();
    reorg.client.getBlock.mockResolvedValueOnce(block).mockResolvedValueOnce({ ...block, hash: `0x${"1".repeat(64)}` });
    await expect(readAaveBaseRiskSnapshot(reorg.client as never, request)).rejects.toThrow(/canonical|block/i);
  });

  it("fails closed when the RPC does not support canonical block-hash calls", async () => {
    const { client } = mockClient();
    client.readContract.mockRejectedValueOnce(new Error("EIP-1898 blockHash unsupported"));
    await expect(readAaveBaseRiskSnapshot(client as never, request)).rejects.toThrow(/EIP-1898/);
    expect(client.readContract).toHaveBeenCalledTimes(1);
  });

  it("rejects ungoverned assets, wrong chains, and stale blocks", async () => {
    await expect(readAaveBaseRiskSnapshot(mockClient().client as never, { ...request, asset: other })).rejects.toThrow(/governed|unsupported/i);
    const wrongChain = mockClient();
    wrongChain.client.getChainId.mockResolvedValueOnce(1);
    await expect(readAaveBaseRiskSnapshot(wrongChain.client as never, request)).rejects.toThrow(/chain/i);
    await expect(readAaveBaseRiskSnapshot(mockClient().client as never,
      { ...request, nowMs: request.nowMs + 30_001 })).rejects.toThrow(/stale/i);
  });

  it("rejects isolation mode and inconsistent Pool/oracle/configuration reads", async () => {
    const isolated = await readAaveBaseRiskSnapshot(mockClient({ getDebtCeiling: 1n }).client as never, request);
    expect(isolated.account.isolationMode).toBe(true);
    expect(() => assessAaveActionRisk(isolated)).toThrow(/mode/i);
    for (const values of [{ getPool: other }, { getAssetPrice: 0n }, { getPaused: undefined }]) {
      const { client } = mockClient(values);
      await expect(readAaveBaseRiskSnapshot(client as never, request)).rejects.toThrow();
    }
  });

  it("rejects contradictory reserve collateral configuration", async () => {
    const { client } = mockClient({ getReserveConfigurationData: [6n, 8_000n, 8_000n,
      10_500n, 1_000n, false, true, false, true, false] });
    await expect(readAaveBaseRiskSnapshot(client as never, request)).rejects.toThrow(/collateral/i);
  });
});
