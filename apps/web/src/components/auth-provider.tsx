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
      <PrivyRuntimeProvider appId={appId}>{children}</PrivyRuntimeProvider>
    </Suspense>
  );
}
