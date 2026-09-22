import { PrivyClient } from "@privy-io/node";
import { isAddress } from "viem";
import { PRIVY_APP_ID } from "@/config/client";
import type { AccountId } from "./types";

export type PortfolioAccount = {
  accountId: AccountId;
  origin: "embedded" | "linked_external";
  proofReference: string;
  linkedAt: string;
};

type WalletAccount = {
  type: string;
  chain_type?: string;
  address?: string;
  id?: string | null;
  connector_type?: string;
  wallet_client_type?: string;
  verified_at?: number | null;
};
type PrivyUser = { id: string; linked_accounts: WalletAccount[] };
type ReadPrivyUser = (subjectReference: string) => Promise<PrivyUser>;

async function readPrivyUser(subjectReference: string): Promise<PrivyUser> {
  if (!process.env.PRIVY_APP_SECRET) throw new Error("Privy server authentication is not configured.");
  const client = new PrivyClient({ appId: PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
  return client.users()._get(subjectReference);
}

/** A fresh Privy link read is required for every historical-account access. */
export async function resolvePortfolioAccounts(
  subjectReference: string,
  readUser: ReadPrivyUser = readPrivyUser
): Promise<PortfolioAccount[]> {
  const user = await readUser(subjectReference);
  if (user.id !== subjectReference) throw new Error("Privy returned a different account.");
  const accounts = new Map<AccountId, PortfolioAccount>();
  for (const linked of user.linked_accounts) {
    if (linked.type !== "wallet" || linked.chain_type !== "ethereum" || !linked.address || !isAddress(linked.address)
      || !Number.isSafeInteger(linked.verified_at) || (linked.verified_at ?? 0) <= 0) continue;
    const address = linked.address.toLowerCase() as `0x${string}`;
    const embedded = linked.connector_type === "embedded" && linked.wallet_client_type === "privy";
    if (embedded && !linked.id) continue;
    const accountId: AccountId = `8453:${address}`;
    const candidate: PortfolioAccount = {
      accountId,
      origin: embedded ? "embedded" : "linked_external",
      proofReference: embedded ? linked.id! : `${subjectReference}:${address}:${linked.verified_at}`,
      linkedAt: new Date(linked.verified_at! * 1000).toISOString()
    };
    const prior = accounts.get(accountId);
    if (!prior || candidate.origin === "embedded") accounts.set(accountId, candidate);
  }
  return [...accounts.values()];
}
