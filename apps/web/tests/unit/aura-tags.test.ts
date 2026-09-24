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
});
