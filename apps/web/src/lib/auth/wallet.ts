import { isAddress } from "viem";
import { WalletOwnershipError } from "@/lib/http/errors";
import { privyClient } from "./privy";

type LinkedAccount = { type: string; chain_type?: string; address?: string; wallet_client_type?: string };
type UserWithWallets = { id: string; linked_accounts: LinkedAccount[] };
type GetUser = (subjectReference: string) => Promise<UserWithWallets>;

export { WalletOwnershipError };

async function getPrivyUser(subjectReference: string): Promise<UserWithWallets> {
  return privyClient().users()._get(subjectReference);
}

/**
 * The wallet Aura prepares actions for: the customer's Privy smart wallet.
 * Never the embedded wallet that signs for it, never an external login
 * wallet, and never an address the browser supplies.
 */
export async function requireActionWallet(subjectReference: string, getUser: GetUser = getPrivyUser): Promise<`0x${string}`> {
  const user = await getUser(subjectReference);
  if (user.id !== subjectReference) throw new WalletOwnershipError();
  // Privy's smart wallet accounts carry no chain_type; they are EVM by construction.
  const chosen = user.linked_accounts.find((account) => account.type === "smart_wallet" && account.address && isAddress(account.address));
  if (!chosen?.address) throw new WalletOwnershipError("Your Aura account isn't set up yet.");
  return chosen.address.toLowerCase() as `0x${string}`;
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
    (account.type === "smart_wallet" || (account.type === "wallet" && account.chain_type === "ethereum")) &&
    account.address?.toLowerCase() === normalized
  )) throw new WalletOwnershipError();
  return normalized;
}
