import { describe, expect, it } from "vitest";
import { WalletOwnershipError, requireLinkedEvmWallet } from "@/lib/auth/wallet";

const subject = "did:privy:owner";
const owned = "0x1111111111111111111111111111111111111111";
const other = "0x2222222222222222222222222222222222222222";

describe("server wallet ownership", () => {
  it("accepts only an Ethereum wallet linked to the authenticated Privy user", async () => {
    const getUser = async (userId: string) => {
      expect(userId).toBe(subject);
      return { id: subject, linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: owned }] };
    };
    await expect(requireLinkedEvmWallet(subject, owned.toUpperCase().replace("0X", "0x"), getUser)).resolves.toBe(owned);
    await expect(requireLinkedEvmWallet(subject, other, getUser)).rejects.toBeInstanceOf(WalletOwnershipError);
  });

  it("rejects other users, chains, and provider outages closed", async () => {
    await expect(requireLinkedEvmWallet(subject, owned, async () => ({
      id: "did:privy:other", linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: owned }]
    }))).rejects.toBeInstanceOf(WalletOwnershipError);
    await expect(requireLinkedEvmWallet(subject, owned, async () => ({
      id: subject, linked_accounts: [{ type: "wallet", chain_type: "solana", address: owned }]
    }))).rejects.toBeInstanceOf(WalletOwnershipError);
    await expect(requireLinkedEvmWallet(subject, owned, async () => { throw new Error("Privy unavailable"); }))
      .rejects.toThrow("Privy unavailable");
  });
});
