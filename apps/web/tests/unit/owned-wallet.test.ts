import { describe, expect, it } from "vitest";
import { WalletOwnershipError, findLegacySmartWallet, requireActionAccount, requireActionWallet, requireLinkedEvmWallet } from "@/lib/auth/wallet";

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

  it("recognizes a Privy smart wallet, which carries no chain type", async () => {
    await expect(requireLinkedEvmWallet(subject, owned, async () => ({
      id: subject, linked_accounts: [{ type: "smart_wallet", address: owned }]
    }))).resolves.toBe(owned);
  });
});

describe("the Aura account", () => {
  const embedded = { type: "wallet", chain_type: "ethereum", wallet_client_type: "privy", connector_type: "embedded", id: "wallet-1", wallet_index: 0, address: owned.toUpperCase().replace("0X", "0x") };
  const second = { ...embedded, id: "wallet-2", wallet_index: 1, address: "0x4444444444444444444444444444444444444444" };
  const smart = { type: "smart_wallet", address: other };
  const external = { type: "wallet", chain_type: "ethereum", wallet_client_type: "metamask", connector_type: "injected", address: "0x3333333333333333333333333333333333333333" };

  it("is the first Privy embedded wallet, with its wallet ID, never a smart wallet or an external wallet", async () => {
    await expect(requireActionAccount(subject, async () => ({ id: subject, linked_accounts: [external, smart, second, embedded] })))
      .resolves.toEqual({ address: owned, walletId: "wallet-1" });
    await expect(requireActionWallet(subject, async () => ({ id: subject, linked_accounts: [embedded] }))).resolves.toBe(owned);
    await expect(requireActionAccount(subject, async () => ({ id: subject, linked_accounts: [external, smart] }))).rejects.toBeInstanceOf(WalletOwnershipError);
    await expect(requireActionAccount(subject, async () => ({ id: subject, linked_accounts: [{ ...embedded, id: null }] }))).rejects.toBeInstanceOf(WalletOwnershipError);
    await expect(requireActionAccount(subject, async () => ({ id: "did:privy:other", linked_accounts: [embedded] }))).rejects.toBeInstanceOf(WalletOwnershipError);
  });

  it("finds the smart wallet an earlier version used, only for the migration", async () => {
    await expect(findLegacySmartWallet(subject, async () => ({ id: subject, linked_accounts: [embedded, smart] }))).resolves.toBe(other);
    await expect(findLegacySmartWallet(subject, async () => ({ id: subject, linked_accounts: [embedded] }))).resolves.toBeNull();
  });
});
