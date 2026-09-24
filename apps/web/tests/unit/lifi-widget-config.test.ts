import { describe, expect, it } from "vitest";
import { swapWidgetConfig } from "@/lib/swap/widget-config";

describe("LI.FI Swap screen", () => {
  it("offers executable swaps across Aurel's connected EVM chains", () => {
    expect(swapWidgetConfig.mode).toBe("default");
    expect(swapWidgetConfig.chains?.allow).toEqual([8453, 1, 42161, 10, 137]);
    expect(swapWidgetConfig.hiddenUI?.history).not.toBe(true);
  });
});
