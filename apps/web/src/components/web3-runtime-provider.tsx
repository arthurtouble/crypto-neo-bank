"use client";

// The Privy runtime: Privy, its smart wallets, and wagmi. AuthProvider (auth-provider.tsx) loads this file only for a
// saved session or when a guest signs in. It and the files only it imports (privy-bridge.tsx, passkey-added-toast.tsx,
// config/chains.ts) are the only client code that may import @privy-io/*, wagmi, or viem's clients at runtime
// (tests/unit/privy-runtime-boundary.test.ts).
import { PrivyProvider } from "@privy-io/react-auth";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider } from "@privy-io/wagmi";
import { web3Config } from "@/config/chains";
import { PRIVY_APP_ID } from "@/config/client";
import { HOME_CHAIN, SUPPORTED_CHAINS } from "@/config/supported-chains";
import { PasskeyAddedToast } from "./passkey-added-toast";
import { PrivyBridge } from "./privy-bridge";

export default function Web3RuntimeProvider({ loginRequested, onLoginOpened, children }: {
  loginRequested: boolean;
  onLoginOpened: () => void;
  children: React.ReactNode;
}) {
  // The QueryClient and toasts are AuthProvider's, so they exist for guests and survive loading this runtime.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        defaultChain: HOME_CHAIN,
        supportedChains: [...SUPPORTED_CHAINS],
        appearance: {
          theme: "light",
          accentColor: "#3d3fe0",
          landingHeader: "Welcome to Aura",
          loginMessage: "Sign in to your Aura account."
        },
        embeddedWallets: {
          // Every customer gets a Privy signer, which owns their smart wallet.
          ethereum: { createOnLogin: "all-users" },
          showWalletUIs: true
        }
      }}
    >
      <SmartWalletsProvider>
        <WagmiProvider config={web3Config}>
          <PrivyBridge loginRequested={loginRequested} onLoginOpened={onLoginOpened}>
            <PasskeyAddedToast />
            {children}
          </PrivyBridge>
        </WagmiProvider>
      </SmartWalletsProvider>
    </PrivyProvider>
  );
}
