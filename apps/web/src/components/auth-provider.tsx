"use client";

import { lazy, Suspense } from "react";
import { PRIVY_APP_ID } from "@/config/client";

const PrivyRuntimeProvider = lazy(async () => {
  const { PrivyProvider } = await import("@privy-io/react-auth");
  return { default: PrivyProvider };
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <PrivyRuntimeProvider
        appId={PRIVY_APP_ID}
        config={{
          loginMethods: ["email", "wallet"],
          appearance: {
            theme: "light",
            accentColor: "#156957",
            landingHeader: "Welcome to Aurel",
            loginMessage: "Secure access to your private digital wealth relationship."
          },
          embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" } }
        }}
      >
        {children}
      </PrivyRuntimeProvider>
    </Suspense>
  );
}
