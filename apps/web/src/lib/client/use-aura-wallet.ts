"use client";

import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback } from "react";
import type { Call } from "@/lib/actions/types";

export type SignOptions = { description: string; buttonText: string };

/**
 * The customer's Aura account: their Privy smart wallet, and nothing else.
 * The Privy embedded wallet only signs for it and a login wallet such as
 * MetaMask never holds Aura funds, so neither is ever shown as the account.
 * The server makes the same choice (`requireActionWallet`).
 */
export function useAuraWallet() {
  const { client, getClientForChain } = useSmartWallets();
  const address = client?.account?.address?.toLowerCase() as `0x${string}` | undefined;

  /** Send an action's calls as one operation and return the transaction hash. */
  const sendCalls = useCallback(async (chainId: number, calls: Call[], options: SignOptions): Promise<`0x${string}`> => {
    if (!client) throw new Error("Your Aura account isn't set up yet.");
    const chainClient = await getClientForChain({ id: chainId }) ?? client;
    return chainClient.sendTransaction(
      { calls: calls.map((call) => ({ to: call.to, value: BigInt(call.value), data: call.data })) },
      { uiOptions: { description: options.description, buttonText: options.buttonText, isCancellable: true } }
    );
  }, [client, getClientForChain]);

  return { address, ready: Boolean(address), sendCalls };
}
