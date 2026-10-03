import type { PrivyClient } from "@privy-io/node";
import { isAddress } from "viem";
import { sha256Hex } from "@/lib/platform/encoding";
import type { TypedData, Venue } from "./types";

/**
 * A customer's trading key: a Privy server wallet that Aura's server signs
 * venue orders with, so placing an order needs no passkey. It holds no funds.
 * The customer's own wallet approves it at the venue, and the venue only lets
 * it trade for that account: Hyperliquid's API wallets can't withdraw or
 * transfer. The key never leaves Privy's enclave; Aura keeps its wallet ID.
 */
export type TradingKey = { walletId: string; address: `0x${string}` };

/** Create a trading key for one customer at one venue. Its external ID ties it to them without naming them. */
export async function createTradingKey(privy: PrivyClient, venue: Venue, subject: string): Promise<TradingKey> {
  const tag = (await sha256Hex(`${venue}:${subject}`)).slice(0, 40);
  const wallet = await privy.wallets().create({ chain_type: "ethereum", display_name: `Aura ${venue} trading key`,
    external_id: `aura-${venue === "hyperliquid" ? "hl" : "pm"}-${tag}-${crypto.randomUUID().slice(0, 8)}` });
  if (!wallet.id || !isAddress(wallet.address)) throw new Error("Privy returned an invalid trading key.");
  return { walletId: wallet.id, address: wallet.address.toLowerCase() as `0x${string}` };
}

/** Sign `typedData` with a trading key. Only for venue actions the key is approved for. */
export async function signWithTradingKey(privy: PrivyClient, key: TradingKey, typedData: TypedData): Promise<`0x${string}`> {
  const { domain, types, primaryType, message } = typedData;
  const result = await privy.wallets().ethereum().signTypedData(key.walletId,
    { params: { typed_data: { domain, types, primary_type: primaryType, message } } });
  if (!/^0x[0-9a-fA-F]{130}$/.test(result.signature)) throw new Error("Privy returned an invalid signature.");
  return result.signature.toLowerCase() as `0x${string}`;
}
