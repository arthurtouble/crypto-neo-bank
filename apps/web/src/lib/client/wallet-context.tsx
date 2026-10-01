"use client";

// What the customer's wallets can do, without loading Privy, wagmi, or viem's clients. The Privy runtime
// (components/web3-runtime-provider.tsx) fills this from Privy's and wagmi's hooks once it has loaded; until then
// (a guest) every capability is absent and chain reads stay idle. Type-only imports from Privy cost nothing at runtime.
import type { ConnectedWallet, useAuthorizationSignature, useExportWallet, useFundWallet } from "@privy-io/react-auth";
import type { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useQuery, type UseQueryResult } from "@tanstack/react-query";
import { createContext, useContext } from "react";

type Address = `0x${string}`;

/** Reads from the chain through the app's wagmi configuration (the same RPCs as before). */
export type ChainReads = {
  nativeBalance: (input: { address: Address; chainId: number }) => Promise<bigint>;
  tokenBalance: (input: { token: Address; owner: Address; chainId: number }) => Promise<bigint>;
  /** Several ERC-20 balances, batched per network. A read that fails is undefined. */
  tokenBalances: (input: Array<{ token: Address; owner: Address; chainId: number }>) => Promise<Array<bigint | undefined>>;
  waitForReceipt: (input: { chainId: number; hash: Address; timeout: number }) => Promise<{ status: "success" | "reverted" }>;
};

export type LinkEmailCallbacks = {
  onSuccess?: (result: { linkMethod: string }) => void;
  onError?: (error: string) => void;
};

export type WalletRuntime = {
  /** Wallets Privy knows for this session: the embedded signer and any wallet the customer connected. */
  wallets: ConnectedWallet[];
  /** Privy's MFA methods for the signed-in customer ("passkey", "totp", …). */
  mfaMethods: string[];
  generateAuthorizationSignature: ReturnType<typeof useAuthorizationSignature>["generateAuthorizationSignature"];
  showMfaEnrollmentModal: () => void;
  fundWallet: ReturnType<typeof useFundWallet>["fundWallet"];
  exportWallet: ReturnType<typeof useExportWallet>["exportWallet"];
  /** Privy's add-email flow. The callbacks apply to this call. */
  linkEmail: (callbacks?: LinkEmailCallbacks) => void;
  /** Privy's change-email modal. */
  updateEmail: () => void;
  connectWallet: () => void;
  /** The smart-wallet client of earlier Aura accounts, when Privy has one. */
  smartWalletClient: ReturnType<typeof useSmartWallets>["client"];
  chain: ChainReads | null;
};

const unavailable = () => Promise.reject(new Error("wallet_unavailable"));
const noop = () => undefined;

/** A guest's: Privy isn't loaded, so there are no wallets, actions reject, and chain reads stay idle. */
export const GUEST_WALLET: WalletRuntime = {
  wallets: [], mfaMethods: [],
  generateAuthorizationSignature: unavailable, showMfaEnrollmentModal: noop, fundWallet: unavailable, exportWallet: unavailable,
  linkEmail: noop, updateEmail: noop, connectWallet: noop, smartWalletClient: undefined, chain: null
};

export const WalletContext = createContext<WalletRuntime>(GUEST_WALLET);

/** The customer's wallet capabilities. Use this instead of Privy's wallet hooks, so a page doesn't depend on Privy's code. */
export function useWallet(): WalletRuntime {
  return useContext(WalletContext);
}

/** The native balance (ETH, POL, …) of an address. Idle until there is an address, a network, and a loaded wallet runtime. */
export function useNativeBalance(address: Address | undefined, chainId: number | undefined, enabled = true): UseQueryResult<bigint> {
  const { chain } = useWallet();
  return useQuery({
    queryKey: ["chain-balance", chainId, "native", address?.toLowerCase()],
    queryFn: () => chain!.nativeBalance({ address: address!, chainId: chainId! }),
    enabled: enabled && Boolean(chain && address && chainId)
  });
}

/** An ERC-20 balance of an address. Idle until there is a token, an owner, a network, and a loaded wallet runtime. */
export function useTokenBalance(token: Address | undefined, owner: Address | undefined, chainId: number | undefined, enabled = true): UseQueryResult<bigint> {
  const { chain } = useWallet();
  return useQuery({
    queryKey: ["chain-balance", chainId, token?.toLowerCase(), owner?.toLowerCase()],
    queryFn: () => chain!.tokenBalance({ token: token!, owner: owner!, chainId: chainId! }),
    enabled: enabled && Boolean(chain && token && owner && chainId)
  });
}

/** Several ERC-20 balances of one owner, in the order given; a failed read is undefined. */
export function useTokenBalances(tokens: Array<{ token: Address; chainId: number }>, owner: Address | undefined, enabled = true): UseQueryResult<Array<bigint | undefined>> {
  const { chain } = useWallet();
  return useQuery({
    queryKey: ["chain-balances", owner?.toLowerCase(), tokens.map((item) => `${item.chainId}:${item.token.toLowerCase()}`)],
    queryFn: () => chain!.tokenBalances(tokens.map((item) => ({ ...item, owner: owner! }))),
    enabled: enabled && Boolean(chain && owner)
  });
}
