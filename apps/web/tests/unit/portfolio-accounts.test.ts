import { describe, expect, it } from "vitest";
import { resolvePortfolioAccounts } from "@/lib/portfolio/accounts";

const embedded = "0x00000000000000000000000000000000000000A1";
const external = "0x00000000000000000000000000000000000000b2";
const foreign = "0x00000000000000000000000000000000000000C3";

describe("portfolio account scope", () => {
  it("uses a fresh same-subject Privy read, never local wallet projections", async () => {
    const read = async () => ({ id: "did:privy:owner", linked_accounts: [
      { type: "wallet", chain_type: "ethereum", address: embedded, connector_type: "embedded", wallet_client_type: "privy", id: "wallet-embedded", verified_at: 100 },
      { type: "wallet", chain_type: "ethereum", address: external, connector_type: "injected", verified_at: 101 },
      { type: "wallet", chain_type: "solana", address: foreign, verified_at: 102 },
      { type: "wallet", chain_type: "ethereum", address: "bad", verified_at: 103 }
    ] });
    expect(await resolvePortfolioAccounts("did:privy:owner", read)).toEqual([
      { accountId: `8453:${embedded.toLowerCase()}`, origin: "embedded", proofReference: "wallet-embedded", linkedAt: new Date(100_000).toISOString() },
      { accountId: `8453:${external.toLowerCase()}`, origin: "linked_external", proofReference: `did:privy:owner:${external.toLowerCase()}:101`, linkedAt: new Date(101_000).toISOString() }
    ]);
  });

  it("rejects a mismatched user and drops an unlinked external wallet on the next read", async () => {
    await expect(resolvePortfolioAccounts("did:privy:owner", async () => ({ id: "did:privy:other", linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: foreign, verified_at: 100 }] }))).rejects.toThrow();
    const current = await resolvePortfolioAccounts("did:privy:owner", async () => ({ id: "did:privy:owner", linked_accounts: [{ type: "wallet", chain_type: "ethereum", address: embedded, connector_type: "embedded", wallet_client_type: "privy", id: "wallet-embedded", verified_at: 100 }] }));
    expect(current.map((account) => account.accountId)).toEqual([`8453:${embedded.toLowerCase()}`]);
  });

  it("omits wallets without a stable Privy proof", async () => {
    const accounts = await resolvePortfolioAccounts("did:privy:owner", async () => ({ id: "did:privy:owner", linked_accounts: [
      { type: "wallet", chain_type: "ethereum", address: embedded, connector_type: "embedded", wallet_client_type: "privy", id: null, verified_at: 100 },
      { type: "wallet", chain_type: "ethereum", address: external, connector_type: "injected", verified_at: null }
    ] }));
    expect(accounts).toEqual([]);
  });
});
