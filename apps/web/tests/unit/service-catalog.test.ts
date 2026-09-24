import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeRailAdapter } from "@/lib/providers/bridge";
import { moneyCapabilities, previewMoneyAccount } from "@/lib/providers/service-catalog";

afterEach(() => vi.unstubAllGlobals());

describe("money provider boundary", () => {
  it("keeps bank rails gated until provider setup", () => {
    const account = previewMoneyAccount("Test Member");
    expect(account.state).toBe("setup_required");
    expect(account.accountNumberLastFour).toBeUndefined();
    expect(moneyCapabilities.filter((item) => item.key !== "crypto").every((item) => item.state === "setup_required" && item.direction === "in")).toBe(true);
  });

  it("does not present masked Bridge details as a live bank payment method", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: "account-1", status: "active", source: { currency: "usd" }, account: { last_4: "1234" } }] })));
    const account = await new BridgeRailAdapter("test-key").getUsdAccount("customer-1", "Test Member");
    expect(account.state).toBe("active");
    expect(account.accountNumberLastFour).toBe("1234");
    expect(account.capabilities.filter((item) => item.key !== "crypto").every((item) => item.state === "locked")).toBe(true);
  });
});
