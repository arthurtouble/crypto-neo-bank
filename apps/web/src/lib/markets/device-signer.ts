import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import type { TypedData } from "./types";

/**
 * Key math for a device's Perps trading key, run in the browser. The key
 * store (lib/client/perps-key.ts) loads this only when the customer trades,
 * so viem's signer stays off every other page.
 */
export const newPrivateKey = (): `0x${string}` => generatePrivateKey();

export const addressOf = (privateKey: `0x${string}`) => privateKeyToAccount(privateKey).address.toLowerCase() as `0x${string}`;

export function signTypedData(privateKey: `0x${string}`, typedData: TypedData): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  return account.signTypedData(typedData as Parameters<typeof account.signTypedData>[0]);
}
