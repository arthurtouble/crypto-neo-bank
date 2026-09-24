import { describe, expect, it } from "vitest";
import { normalizeAuraTag, publicTagResponse } from "@/lib/aura-tags";

describe("Aura tags", () => {
  it("normalizes a claim and rejects ambiguous or reserved names", () => {
    expect(normalizeAuraTag(" @Alice_7 ")).toBe("alice_7");
    for (const value of ["admin", "Support", "a", "alice..pay", "álîce", "aura", "pay"]) {
      expect(() => normalizeAuraTag(value)).toThrow();
    }
  });

  it("never exposes private owner details or unconnected payment methods", () => {
    expect(publicTagResponse({ tag: "alice", display_name: "Alice", receiving_address: "0x000000000000000000000000000000000000dEaD", subject_reference: "privy-secret" })).toEqual({
      tag: "alice", displayName: "Alice", crypto: { network: "Base", address: "0x000000000000000000000000000000000000dEaD" },
      bank: { available: false }, card: { available: false }
    });
  });

  it("shows bank instructions only after separate public consent and an active provider account", () => {
    const row = { tag: "alice", display_name: "Alice", receiving_address: "0x000000000000000000000000000000000000dEaD", subject_reference: "privy-secret", public_bank_enabled: 1 };
    const bank = { state: "active" as const, currency: "USD" as const, accountName: "Alice", capabilities: [], depositInstructions: { bankName: "Lead Bank", beneficiaryName: "Alice", accountNumber: "123456789", routingNumber: "876543210", rails: ["ach" as const] } };
    expect(publicTagResponse(row, bank).bank).toMatchObject({ available: true, instructions: { accountNumber: "123456789" } });
    expect(publicTagResponse({ ...row, public_bank_enabled: 0 }, bank).bank).toEqual({ available: false });
  });
});
