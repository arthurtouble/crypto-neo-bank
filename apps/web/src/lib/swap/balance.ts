import { erc20Abi, type PublicClient } from "viem";
import { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { publicClient } from "@/lib/chain/rpc";
import { formatUnits } from "@/lib/format/units";
import { HttpError } from "@/lib/http/errors";
import { ActionInputError } from "@/lib/actions/transfer";
import type { CatalogAsset } from "./assets";

type Paying = Pick<CatalogAsset, "chainId" | "address" | "symbol" | "decimals">;
export type BalanceReader = (asset: Paying, wallet: `0x${string}`) => Promise<bigint>;

/** The account's balance of an asset, read from its chain. */
export const readHeld: BalanceReader = async (asset, wallet) => {
  const chain = SUPPORTED_CHAINS.find((item) => item.id === asset.chainId);
  if (!chain) throw new Error("Unsupported asset chain.");
  const client: PublicClient = publicClient(chain);
  return asset.address === null ? client.getBalance({ address: wallet })
    : client.readContract({ address: asset.address as `0x${string}`, abi: erc20Abi, functionName: "balanceOf", args: [wallet] });
};

/**
 * Refuse a swap the account can't pay for, before anything is quoted or sent.
 * Without this, an over-balance swap goes to the chain, fails there, and Aura
 * pays its network fee. Aura pays the fee on the paying network, so the whole
 * balance can be swapped, ETH included. A balance that can't be read refuses too.
 */
export async function requireSwapBalance(asset: Paying, wallet: string, amountRaw: bigint, read: BalanceReader = readHeld): Promise<void> {
  let held: bigint;
  try { held = await read(asset, wallet as `0x${string}`); }
  catch { throw new HttpError(503, "balance_unavailable", "Your balance can't be read right now. Try again in a minute."); }
  if (held < amountRaw) throw new ActionInputError("insufficient_balance", held === 0n
    ? `You don't have any ${asset.symbol}.`
    : `You have ${formatUnits(held, asset.decimals)} ${asset.symbol}. Enter that or less.`);
}
