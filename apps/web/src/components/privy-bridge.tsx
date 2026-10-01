"use client";

// Inside the Privy runtime only (web3-runtime-provider.tsx imports this; nothing else may): turns Privy's and
// wagmi's hooks into the Privy-free contexts screens read (lib/client/auth.tsx, lib/client/wallet-context.tsx).
import {
  useAuthorizationSignature, useExportWallet, useFundWallet, useLinkAccount, useMfa, useMfaEnrollment, usePrivy, useWallets
} from "@privy-io/react-auth";
import { useSmartWallets } from "@privy-io/react-auth/smart-wallets";
import { useUpdateEmail } from "@privy-io/react-auth/ui";
import { useCallback, useEffect, useMemo, useRef } from "react";
import { erc20Abi } from "viem";
import { useConfig } from "wagmi";
import { getBalance, readContract, readContracts, waitForTransactionReceipt } from "wagmi/actions";
import type { SUPPORTED_CHAINS } from "@/config/supported-chains";
import { AuthContext, type AuthState } from "@/lib/client/auth";
import { WalletContext, type ChainReads, type LinkEmailCallbacks, type WalletRuntime } from "@/lib/client/wallet-context";

type ChainId = (typeof SUPPORTED_CHAINS)[number]["id"];
const noop = () => undefined;

export function PrivyBridge({ loginRequested, onLoginOpened, children }: {
  /** A guest asked to sign in before Privy loaded: open Privy's sign-in as soon as it's ready. */
  loginRequested: boolean;
  onLoginOpened: () => void;
  children: React.ReactNode;
}) {
  const privy = usePrivy();
  const { wallets } = useWallets();
  const { mfaMethods } = useMfa();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { fundWallet } = useFundWallet();
  const { exportWallet } = useExportWallet();
  const { update: updateEmail } = useUpdateEmail();
  const { client: smartWalletClient } = useSmartWallets();
  const config = useConfig();
  // Privy takes the add-email callbacks when the hook mounts; the caller's apply to the flow it starts, then are cleared.
  const linkCallbacks = useRef<LinkEmailCallbacks>({});
  const { linkEmail: startLinkEmail } = useLinkAccount({
    onSuccess: ({ linkMethod }) => { const { onSuccess } = linkCallbacks.current; linkCallbacks.current = {}; onSuccess?.({ linkMethod }); },
    onError: (error) => { const { onError } = linkCallbacks.current; linkCallbacks.current = {}; onError?.(error); }
  });
  const linkEmail = useCallback((callbacks: LinkEmailCallbacks = {}) => { linkCallbacks.current = callbacks; startLinkEmail(); }, [startLinkEmail]);

  const { ready, authenticated, user, login, logout, getAccessToken, connectWallet } = privy;
  useEffect(() => {
    if (!loginRequested || !ready) return;
    onLoginOpened();
    if (!authenticated) login();
  }, [loginRequested, ready, authenticated, login, onLoginOpened]);

  // While Privy starts after a guest's Sign in, the page stays as the guest saw it; Privy's sign-in then opens.
  const opening = loginRequested && !ready;
  const auth = useMemo<AuthState>(() => ({
    ready: ready || opening, authenticated, user, logout, getAccessToken,
    login: opening ? noop : () => login()
  }), [ready, opening, authenticated, user, login, logout, getAccessToken]);

  const chain = useMemo<ChainReads>(() => ({
    nativeBalance: async ({ address, chainId }) => (await getBalance(config, { address, chainId: chainId as ChainId })).value,
    tokenBalance: ({ token, owner, chainId }) => readContract(config, { address: token, abi: erc20Abi, functionName: "balanceOf", args: [owner], chainId: chainId as ChainId }),
    tokenBalances: async (list) => (await readContracts(config, { allowFailure: true, contracts: list.map(({ token, owner, chainId }) => (
      { address: token, abi: erc20Abi, functionName: "balanceOf" as const, args: [owner] as const, chainId: chainId as ChainId })) }))
      .map((result) => result.status === "success" ? result.result as bigint : undefined),
    waitForReceipt: async ({ chainId, hash, timeout }) => ({ status: (await waitForTransactionReceipt(config, { chainId: chainId as ChainId, hash, timeout })).status })
  }), [config]);

  const wallet = useMemo<WalletRuntime>(() => ({
    wallets, mfaMethods, generateAuthorizationSignature, showMfaEnrollmentModal: () => showMfaEnrollmentModal(),
    fundWallet, exportWallet, linkEmail, updateEmail: () => updateEmail(), connectWallet: () => connectWallet(), smartWalletClient, chain
  }), [wallets, mfaMethods, generateAuthorizationSignature, showMfaEnrollmentModal, fundWallet, exportWallet, linkEmail, updateEmail, connectWallet, smartWalletClient, chain]);

  return <AuthContext.Provider value={auth}><WalletContext.Provider value={wallet}>{children}</WalletContext.Provider></AuthContext.Provider>;
}
