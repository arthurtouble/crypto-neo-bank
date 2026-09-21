"use client";

import { lazy, Suspense } from "react";

const Web3RuntimeProvider = lazy(() => import("./web3-runtime-provider"));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={children}>
      <Web3RuntimeProvider>{children}</Web3RuntimeProvider>
    </Suspense>
  );
}
