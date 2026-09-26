"use client";

// Stands in for @privy-io/react-auth in end-to-end tests (see vite.config.ts).
// A test stores the identity Privy would return in localStorage
// ("aura-e2e-session": userId, token, wallet, email, mfa) before the page
// loads. "Signing in" marks it active, as Privy's login modal would. Tokens are
// minted by the fake edge server and verified by Aura's real server code.
// A connected wallet sends through the fake edge, which moves balances like a
// chain; "aura-e2e-wallet" = "reject" makes it refuse, as a customer would.
// Card payments are recorded in window.__auraE2E.fundWallet; "aura-e2e-card" =
// "fail" makes Privy's card flow fail. Approving a money action stands in for
// the passkey prompt: "aura-e2e-passkey" = "reject" cancels it. Opening
// Privy's passkey setup is counted in window.__auraE2E.mfaEnrollment.

import { createElement, Fragment, useSyncExternalStore, type ReactNode } from "react";

type Session = { userId: string; token: string; wallet: string; email?: string; mfa?: string[]; externalWallets?: string[] };
type Snapshot = { ready: boolean; session: Session | null; signedIn: boolean };

const SESSION_KEY = "aura-e2e-session";
const SIGNED_IN_KEY = "aura-e2e-signed-in";
declare const __AURA_E2E_EDGE__: string;
type Recorder = { fundWallet: unknown[]; mfaEnrollment: number };
const recorder = () => ((window as unknown as { __auraE2E?: Recorder }).__auraE2E ??= { fundWallet: [], mfaEnrollment: 0 });
const listeners = new Set<() => void>();
const serverSnapshot: Snapshot = { ready: false, session: null, signedIn: false };
let cached: { raw: string; snapshot: Snapshot } | null = null;

function read(): Snapshot {
  const raw = `${localStorage.getItem(SESSION_KEY) ?? ""}|${localStorage.getItem(SIGNED_IN_KEY) ?? ""}`;
  if (cached?.raw !== raw) {
    const session = localStorage.getItem(SESSION_KEY);
    cached = { raw, snapshot: { ready: true, session: session ? JSON.parse(session) as Session : null, signedIn: localStorage.getItem(SIGNED_IN_KEY) === "1" } };
  }
  return cached.snapshot;
}

function notify() { for (const listener of listeners) listener(); }
function subscribe(listener: () => void) { listeners.add(listener); return () => listeners.delete(listener); }
const useSnapshot = () => useSyncExternalStore(subscribe, read, () => serverSnapshot);

function user(session: Session) {
  const embedded = { type: "wallet", address: session.wallet, chainType: "ethereum", walletClientType: "privy", connectorType: "embedded" };
  return {
    id: session.userId,
    email: session.email ? { address: session.email } : undefined,
    wallet: embedded,
    linkedAccounts: [
      ...(session.email ? [{ type: "email", address: session.email }] : []),
      embedded,
      ...(session.externalWallets ?? []).map((address) => ({ type: "wallet", address, chainType: "ethereum", walletClientType: "metamask", connectorType: "injected" }))
    ],
    mfaMethods: session.mfa ?? []
  };
}

export function usePrivy() {
  const { ready, session, signedIn } = useSnapshot();
  const authenticated = ready && signedIn && session !== null;
  return {
    ready,
    authenticated,
    user: authenticated ? user(session) : null,
    login: () => { if (localStorage.getItem(SESSION_KEY)) { localStorage.setItem(SIGNED_IN_KEY, "1"); notify(); } },
    logout: async () => { localStorage.removeItem(SIGNED_IN_KEY); notify(); },
    getAccessToken: async () => authenticated ? session.token : null,
    connectWallet: () => undefined,
    linkWallet: () => undefined
  };
}

/** A MetaMask-like wallet the customer connected: it signs and pays for its own transactions. */
function connectedWallet(address: string) {
  let chainId = 8453;
  const provider = {
    async request({ method, params }: { method: string; params?: unknown[] }) {
      if (method === "eth_chainId") return `0x${chainId.toString(16)}`;
      if (method !== "eth_sendTransaction") throw new Error(`${method} is not supported by the test wallet`);
      if (localStorage.getItem("aura-e2e-wallet") === "reject") throw new Error("User rejected the request.");
      const tx = (params?.[0] ?? {}) as { from: string; to: string; data?: string; value?: string };
      const response = await fetch(`${__AURA_E2E_EDGE__}/__wallet/send`, { method: "POST", body: JSON.stringify({ chainId, ...tx }) });
      if (!response.ok) throw new Error("The network is unavailable.");
      return (await response.json() as { hash: string }).hash;
    }
  };
  return { address, walletClientType: "metamask", connectorType: "injected", get chainId() { return `eip155:${chainId}`; },
    switchChain: async (id: number) => { chainId = id; }, getEthereumProvider: async () => provider };
}

export function useWallets() {
  const { session, signedIn } = useSnapshot();
  if (!session || !signedIn) return { ready: true, wallets: [] };
  return { ready: true, wallets: [
    { address: session.wallet, walletClientType: "privy", connectorType: "embedded", chainId: "eip155:8453" },
    ...(session.externalWallets ?? []).map(connectedWallet)
  ] };
}

export const useMfa = () => ({ mfaMethods: usePrivy().user?.mfaMethods ?? [] });
export const useMfaEnrollment = () => ({ showMfaEnrollmentModal: () => { recorder().mfaEnrollment += 1; }, closeMfaEnrollmentModal: () => undefined });
export const useAuthorizationSignature = () => ({ generateAuthorizationSignature: async () => {
  if (localStorage.getItem("aura-e2e-passkey") === "reject") throw new Error("User cancelled the passkey request.");
  return { signature: "ZTJlLWZha2Utc2lnbmF0dXJlLWZvci10ZXN0cy1vbmx5" };
} });
export const useFundWallet = () => ({ fundWallet: async (input: unknown) => {
  recorder().fundWallet.push(input);
  if (localStorage.getItem("aura-e2e-card") === "fail") throw new Error("The card payment was declined.");
} });
export const useExportWallet = () => ({ exportWallet: async () => undefined });
export const useSetWalletRecovery = () => ({ setWalletRecovery: async () => undefined });

export function PrivyProvider({ children }: { children: ReactNode; appId?: string; config?: unknown }) {
  return createElement(Fragment, null, children);
}
