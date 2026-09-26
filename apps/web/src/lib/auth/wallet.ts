import { isAddress } from "viem";
import { WalletOwnershipError } from "@/lib/http/errors";
import { privyClient } from "./privy";

type LinkedAccount = { type: string; chain_type?: string; address?: string; wallet_client_type?: string; connector_type?: string;
  id?: string | null; wallet_index?: number };
type UserWithWallets = { id: string; linked_accounts: LinkedAccount[] };
type GetUser = (subjectReference: string) => Promise<UserWithWallets>;

export { WalletOwnershipError };

async function getPrivyUser(subjectReference: string): Promise<UserWithWallets> {
  return privyClient().users()._get(subjectReference);
}

export type ActionAccount = { address: `0x${string}`; walletId: string };

/**
 * The customer's Aura account: their first Privy embedded Ethereum wallet,
 * which Privy runs in its secure enclave and upgrades for sponsored,
 * batched calls. Never an external wallet, and never an address the
 * browser supplies.
 */
export async function requireActionAccount(subjectReference: string, getUser: GetUser = getPrivyUser): Promise<ActionAccount> {
  const user = await getUser(subjectReference);
  if (user.id !== subjectReference) throw new WalletOwnershipError();
  const chosen = user.linked_accounts
    .filter((account) => account.type === "wallet" && account.chain_type === "ethereum" && account.wallet_client_type === "privy"
      && account.connector_type === "embedded" && account.id && account.address && isAddress(account.address))
    .sort((a, b) => (a.wallet_index ?? 0) - (b.wallet_index ?? 0))[0];
  if (!chosen?.address || !chosen.id) throw new WalletOwnershipError("Your Aura account isn't set up yet.");
  return { address: chosen.address.toLowerCase() as `0x${string}`, walletId: chosen.id };
}

/** The Aura account's address, for code that only needs to read or pay to it. */
export async function requireActionWallet(subjectReference: string, getUser: GetUser = getPrivyUser): Promise<`0x${string}`> {
  return (await requireActionAccount(subjectReference, getUser)).address;
}

/** The smart wallet an earlier version of Aura used as the account, if the customer has one. Only the migration reads it. */
export async function findLegacySmartWallet(subjectReference: string, getUser: GetUser = getPrivyUser): Promise<`0x${string}` | null> {
  const user = await getUser(subjectReference);
  if (user.id !== subjectReference) throw new WalletOwnershipError();
  const legacy = user.linked_accounts.find((account) => account.type === "smart_wallet" && account.address && isAddress(account.address));
  return legacy?.address ? legacy.address.toLowerCase() as `0x${string}` : null;
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
