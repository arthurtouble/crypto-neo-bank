import { describe, expect, it } from "vitest";
import { holdingActions } from "@/lib/overview/actions";

const usdc = "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913";
const eurc = "8453:0x60a3e35cc302bfa44cb288bc5a4f316fdb1adb42";
const apple = "8453:0xb200000000000000000000c2e324d24d7eecd1fb";
const xaut = "1:0x68749665ff8d2d112fa859aa293f07a622782f38";
const weth = "0x4200000000000000000000000000000000000006";
const swap = (from: string, to: string) => `/app/swap?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
const labels = (actions: ReturnType<typeof holdingActions>) => actions.map((action) => action.label);

describe("holding actions on Overview", () => {
  it("buys and sells stocks, gold, and crypto for USDC, and sends them", () => {
    for (const [id, group, symbol] of [[apple, "stocks", "AAPLc"], [xaut, "metals", "XAUt"], ["8453:native", "crypto", "ETH"]] as const) {
      const actions = holdingActions({ id, group, symbol });
      expect(labels(actions)).toEqual(["Buy", "Sell", "Send"]);
      expect(actions[0]).toMatchObject({ href: swap(usdc, id), primary: true });
      expect(actions[1]).toMatchObject({ href: swap(id, usdc), primary: false });
      expect(actions[2].href).toBe(`/app/send?asset=${symbol}`);
    }
  });

  it("sends, adds, and swaps cash, with Swap going from USDC to ETH and from the euro to USDC", () => {
    const dollars = holdingActions({ id: usdc, group: "cash", symbol: "USDC" });
    expect(labels(dollars)).toEqual(["Send", "Add money", "Swap"]);
    expect(dollars.filter((action) => action.primary).map((action) => action.label)).toEqual(["Send"]);
    expect(dollars[1].href).toBe("/app/deposit#receive");
    expect(dollars[2].href).toBe(swap(usdc, "8453:native"));
    expect(holdingActions({ id: eurc, group: "cash", symbol: "EURC" })[2].href).toBe(swap(eurc, usdc));
  });

  it("opens an Earn position on Earn, to withdraw or deposit, and only to withdraw from Aave WETH", () => {
    const aave = `aave:${usdc}`;
    expect(holdingActions({ id: aave, group: "earn", symbol: "USDC" })).toEqual([
      { label: "Withdraw", href: `/app/earn?position=${encodeURIComponent(aave)}&action=withdraw`, primary: true },
      { label: "Deposit", href: `/app/earn?position=${encodeURIComponent(aave)}&action=deposit` }
    ]);
    expect(labels(holdingActions({ id: `aave:8453:${weth}`, group: "earn", symbol: "WETH" }))).toEqual(["Withdraw"]);
  });

  it("offers nothing for an asset that isn't registered", () => {
    expect(holdingActions({ id: "8453:0x0000000000000000000000000000000000000001", group: "crypto", symbol: "XYZ" })).toEqual([]);
  });
});
