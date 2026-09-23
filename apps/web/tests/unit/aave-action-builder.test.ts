import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareAaveBaseAction } from "@/lib/defi/aave";

afterEach(() => vi.unstubAllGlobals());

describe("Aave V3 action builder", () => {
  it("keeps supply collateral selection out of the v3 preview but in preparation", async () => {
    const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => {
      const call = JSON.parse(String(init.body)).params;
      calls.push(call);
      return Response.json({ jsonrpc: "2.0", id: 1, result: { structuredContent: { data: { v3: {} } } } });
    }));

    await prepareAaveBaseAction({
      action: "supply",
      sender: "0x1111111111111111111111111111111111111111",
      symbol: "USDC",
      amount: "10.5",
      enableCollateral: true
    });

    const baseArguments = {
      action: "supply",
      version: "v3",
      sender: "0x1111111111111111111111111111111111111111",
      market: "0xA238Dd80C259a72e81d7e4664a9801593F98d1c5",
      token: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      chainId: 8453,
      amount: "10.5"
    };
    expect(calls).toEqual([
      { name: "preview_action", arguments: baseArguments },
      { name: "prepare_action", arguments: { ...baseArguments, enableCollateral: true } }
    ]);
  });
});
