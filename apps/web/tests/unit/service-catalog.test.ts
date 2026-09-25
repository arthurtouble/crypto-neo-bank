import { afterEach, describe, expect, it, vi } from "vitest";
import { BridgeClient, getUsdAccount } from "@/lib/providers/bridge";
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
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "account-1", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push", "wire"], bank_name: "Lead Bank", bank_beneficiary_name: "Test Member", bank_account_number: "123456789", bank_routing_number: "876543210" } }] })).mockResolvedValue(Response.json({ data: [] }));
    vi.stubGlobal("fetch", fetcher);
    const account = await getUsdAccount(new BridgeClient("test-key"), "customer-1");
    expect(fetcher.mock.calls[0][0]).toBe("https://api.bridge.xyz/v0/customers/customer-1/virtual_accounts?limit=100");
    expect(account.state).toBe("active");
    expect(account.depositInstructions).toMatchObject({ accountNumber: "123456789", routingNumber: "876543210", beneficiaryName: "Test Member" });
    expect(account.capabilities.find((item) => item.key === "ach")?.state).toBe("available");
    expect(account.capabilities.find((item) => item.key === "wire")?.state).toBe("available");
    expect(account.capabilities.find((item) => item.key === "fednow")?.state).toBe("locked");
  });

  it("keeps bank instructions unavailable when the provider response is incomplete", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "account-1", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push"], bank_account_number: "123456789" } }] })).mockResolvedValue(Response.json({ data: [] })));
    const account = await getUsdAccount(new BridgeClient("test-key"), "customer-1");
    expect(account.state).toBe("pending");
    expect(account.depositInstructions).toBeUndefined();
    expect(account.capabilities.find((item) => item.key === "ach")?.state).toBe("locked");
  });

  it("does not use another customer's virtual account", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: "account-2", customer_id: "customer-2", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["ach_push"], bank_name: "Lead Bank", bank_beneficiary_name: "Other", bank_account_number: "123456789", bank_routing_number: "876543210" } }] })).mockResolvedValue(Response.json({ data: [] })));
    const account = await getUsdAccount(new BridgeClient("test-key"), "customer-1");
    expect(account.state).toBe("setup_required");
    expect(account.depositInstructions).toBeUndefined();
  });

  it("finds an older activated USD account after a full page", async () => {
    const first = Array.from({ length: 100 }, (_, index) => ({ id: `account-${index + 1}`, customer_id: "customer-1", status: "deactivated", source_deposit_instructions: { currency: "usd" } }));
    const older = { id: "account-101", customer_id: "customer-1", status: "activated", source_deposit_instructions: { currency: "usd", payment_rails: ["fednow"], bank_name: "Lead Bank", bank_beneficiary_name: "Test Member", bank_account_number: "123456789", bank_routing_number: "876543210" } };
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: first })).mockResolvedValueOnce(Response.json({ data: [older] }));
    vi.stubGlobal("fetch", fetcher);
    const account = await getUsdAccount(new BridgeClient("test-key"), "customer-1");
    expect(fetcher.mock.calls[1][0]).toBe("https://api.bridge.xyz/v0/customers/customer-1/virtual_accounts?limit=100&starting_after=account-100");
    expect(account.state).toBe("active");
    expect(account.capabilities.find((item) => item.key === "fednow")?.state).toBe("available");
  });

  it("fails closed when the provider repeats a cursor instead of completing the list", async () => {
    const first = Array.from({ length: 100 }, () => ({ id: "account-1", customer_id: "customer-1", status: "deactivated" }));
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ data: first })));
    await expect(getUsdAccount(new BridgeClient("test-key"), "customer-1")).rejects.toThrow(/cursor/i);
  });
});
