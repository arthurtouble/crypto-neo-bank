"use client";

import { lazy, Suspense } from "react";

const PrivyRuntimeProvider = lazy(async () => {
  const { PrivyProvider } = await import("@privy-io/react-auth");
  return { default: PrivyProvider };
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return children;
  }

  return (
    <Suspense fallback={children}>
      <PrivyRuntimeProvider
        appId={appId}
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
