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

  it("uses activated Bridge instructions and only the rails Bridge returned", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: "account-1", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push", "wire"], bank_name: "Lead Bank", bank_beneficiary_name: "Test Member", bank_account_number: "123456789", bank_routing_number: "876543210" } }] })));
    const account = await new BridgeRailAdapter("test-key").getUsdAccount("customer-1");
    expect(account.state).toBe("active");
    expect(account.depositInstructions).toMatchObject({ accountNumber: "123456789", routingNumber: "876543210", beneficiaryName: "Test Member" });
    expect(account.capabilities.find((item) => item.key === "ach")?.state).toBe("available");
    expect(account.capabilities.find((item) => item.key === "wire")?.state).toBe("available");
    expect(account.capabilities.find((item) => item.key === "fednow")?.state).toBe("locked");
  });

  it("keeps bank instructions unavailable when the provider response is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: "account-1", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push"], bank_account_number: "123456789" } }] })));
    const account = await new BridgeRailAdapter("test-key").getUsdAccount("customer-1");
    expect(account.state).toBe("pending");
    expect(account.depositInstructions).toBeUndefined();
    expect(account.capabilities.find((item) => item.key === "ach")?.state).toBe("locked");
  });

  it("does not use another customer's virtual account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: [{ id: "account-2", customer_id: "customer-2", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push"], bank_name: "Lead Bank", bank_beneficiary_name: "Other", bank_account_number: "123456789", bank_routing_number: "876543210" } }] })));
    const account = await new BridgeRailAdapter("test-key").getUsdAccount("customer-1");
    expect(account.state).toBe("setup_required");
    expect(account.depositInstructions).toBeUndefined();
  });
});
