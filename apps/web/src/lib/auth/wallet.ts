import { PrivyClient } from "@privy-io/node";
import { isAddress } from "viem";
import { PRIVY_APP_ID } from "@/config/client";

type LinkedAccount = { type: string; chain_type?: string; address?: string };
type UserWithWallets = { id: string; linked_accounts: LinkedAccount[] };
type GetUser = (subjectReference: string) => Promise<UserWithWallets>;

export class WalletOwnershipError extends Error {
  constructor() {
    super("This wallet is not linked to your account.");
    this.name = "WalletOwnershipError";
  }
}

async function getPrivyUser(subjectReference: string): Promise<UserWithWallets> {
  if (!process.env.PRIVY_APP_SECRET) throw new Error("Privy server authentication is not configured.");
  const client = new PrivyClient({ appId: PRIVY_APP_ID, appSecret: process.env.PRIVY_APP_SECRET });
  return client.users()._get(subjectReference);
}

/** Resolve ownership from Privy, never from a client-supplied address or D1 projection. */
export async function requireLinkedEvmWallet(
  subjectReference: string,
  address: string,
  getUser: GetUser = getPrivyUser
): Promise<string> {
  if (!isAddress(address)) throw new WalletOwnershipError();
  const user = await getUser(subjectReference);
  const normalized = address.toLowerCase();
  if (user.id !== subjectReference || !user.linked_accounts.some((account) =>
    (account.type === "wallet" || account.type === "smart_wallet") &&
    account.chain_type === "ethereum" &&
    account.address?.toLowerCase() === normalized
  )) throw new WalletOwnershipError();
  return normalized;
}
