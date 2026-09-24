"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { PrivyProvider } from "@privy-io/react-auth";
import { WagmiProvider } from "@privy-io/wagmi";
import { useState } from "react";
import { HOME_CHAIN, SUPPORTED_CHAINS, web3Config } from "@/config/chains";
import { PRIVY_APP_ID } from "@/config/client";

export default function Web3RuntimeProvider({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({
    defaultOptions: { queries: { staleTime: 12_000, retry: 2, refetchOnWindowFocus: false } }
  }));

  return (
    <PrivyProvider
      appId={PRIVY_APP_ID}
      config={{
        loginMethods: ["email", "wallet"],
        defaultChain: HOME_CHAIN,
        supportedChains: [...SUPPORTED_CHAINS],
        appearance: {
          theme: "light",
          accentColor: "#123524",
          landingHeader: "Welcome to Aura",
          loginMessage: "Secure access to your private digital wealth relationship."
        },
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true
        }
      }}
    >
      <QueryClientProvider client={queryClient}>
        <WagmiProvider config={web3Config}>{children}</WagmiProvider>
      </QueryClientProvider>
    </PrivyProvider>
  );
}
