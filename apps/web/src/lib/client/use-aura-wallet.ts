"use client";

import { useWallets } from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useCallback } from "react";
import type { Call } from "@/lib/actions/types";

export type SignOptions = { description: string; buttonText: string };

/**
 * The customer's Aura wallet: their Privy smart wallet, or their Privy
 * embedded wallet until a smart wallet exists. The server makes the same
 * choice (`requireActionWallet`), so both sides agree on the address.
 */
export function useAuraWallet() {
  const { client, getClientForChain } = useSmartWallets();
  const { wallets, ready } = useWallets();
  const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
  const address = (client?.account?.address ?? embedded?.address)?.toLowerCase() as `0x${string}` | undefined;

  /** Send an action's calls as one operation and return the transaction hash. */
  const sendCalls = useCallback(async (chainId: number, calls: Call[], options: SignOptions): Promise<`0x${string}`> => {
    const uiOptions = { description: options.description, buttonText: options.buttonText, isCancellable: true };
    const txs = calls.map((call) => ({ to: call.to, value: BigInt(call.value), data: call.data }));
    if (client) {
      const chainClient = await getClientForChain({ id: chainId }) ?? client;
      return chainClient.sendTransaction({ calls: txs }, { uiOptions });
    }
    if (!embedded) throw new Error("Your Aura wallet isn't ready yet.");
    if (txs.length !== 1) throw new Error("This action needs your Aura smart wallet, which isn't set up yet.");
    await embedded.switchChain(chainId);
    const provider = await embedded.getEthereumProvider();
    return provider.request({ method: "eth_sendTransaction", params: [{ from: embedded.address, to: txs[0].to,
      value: `0x${txs[0].value.toString(16)}`, data: txs[0].data }] }) as Promise<`0x${string}`>;
  }, [client, getClientForChain, embedded]);

  return { address, ready: ready && Boolean(address), isSmartWallet: Boolean(client), sendCalls };
}
