"use client";

// The Privy runtime: Privy, its smart wallets, and wagmi. AuthProvider (auth-provider.tsx) loads this file only for a
// saved session or when a guest signs in. It and the files only it imports (privy-bridge.tsx, passkey-added-toast.tsx,
// config/chains.ts) are the only client code that may import @privy-io/*, wagmi, or viem's clients at runtime
// (tests/unit/privy-runtime-boundary.test.ts).
import { PrivyProvider } from "@privy-io/react-auth";
import { useSyncExternalStore } from "react";
import { SmartWalletsProvider } from "@privy-io/react-auth/smart-wallets";
import { WagmiProvider } from "@privy-io/wagmi";
import { web3Config } from "@/config/chains";
import { PRIVY_APP_ID } from "@/config/client";
import { HOME_CHAIN, SUPPORTED_CHAINS } from "@/config/supported-chains";
import { PasskeyAddedToast } from "./passkey-added-toast";
import { PrivyBridge } from "./privy-bridge";

// Privy's sign-in window follows the page's theme (theme-choice.tsx sets `data-theme` on <html>) and takes its accent
// from the design tokens, read when the theme changes; Privy takes a colour value, not a CSS variable.
type Look = { theme: "light" | "dark"; accent: `#${string}` };
let look: Look | null = null;
function readLook(): Look {
  const root = document.documentElement;
  const theme = root.dataset.theme === "dark" ? "dark" : "light";
  if (look?.theme !== theme) look = { theme, accent: getComputedStyle(root).getPropertyValue("--color-accent").trim() as `#${string}` };
  return look;
}
function watchTheme(onChange: () => void) {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => observer.disconnect();
}

export default function Web3RuntimeProvider({ loginRequested, onLoginOpened, children }: {
  loginRequested: boolean;
  onLoginOpened: () => void;
  children: React.ReactNode;
}) {
  const { theme, accent } = useSyncExternalStore(watchTheme, readLook, readLook);
  // The QueryClient and toasts are AuthProvider's, so they exist for guests and survive loading this runtime.
  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        // Google and Telegram also have to be turned on for the Privy app in Privy's dashboard (production-launch.md).
        loginMethods: ["email", "google", "telegram", "wallet"],
        defaultChain: HOME_CHAIN,
        supportedChains: [...SUPPORTED_CHAINS],
        appearance: {
          theme,
          accentColor: accent,
          logo: "/icon.svg",
          landingHeader: "Welcome to Aura",
          loginMessage: "Your first sign-in creates your account."
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
