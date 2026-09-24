import type { MoneyAccount } from "./providers/service-catalog";

const reserved = new Set(["admin", "aura", "bank", "billing", "card", "help", "pay", "security", "support", "system"]);

export function normalizeAuraTag(input: string): string {
  const tag = input.trim().replace(/^@/, "").toLowerCase();
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(tag) || reserved.has(tag)) throw new Error("Choose a tag with 3–24 letters, numbers, or underscores.");
  return tag;
}

export type AuraTagRow = {
  tag: string;
  subject_reference: string;
  receiving_address: string;
  display_name: string;
  public_bank_enabled?: number;
};

export function publicTagResponse(row: AuraTagRow, account?: MoneyAccount) {
  const bank = row.public_bank_enabled === 1 && account?.state === "active" && account.depositInstructions
    ? { available: true, instructions: account.depositInstructions }
    : { available: false };
  return {
    tag: row.tag,
    displayName: row.display_name,
    crypto: { network: "Base", address: row.receiving_address },
    bank,
    card: { available: false }
  };
}
