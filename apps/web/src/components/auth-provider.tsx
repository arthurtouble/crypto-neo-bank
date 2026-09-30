"use client";

import { lazy, Suspense } from "react";
import { LoadingScreen } from "./states";

const Web3RuntimeProvider = lazy(() => import("./web3-runtime-provider"));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<LoadingScreen label="Getting your wallet ready" />}>
      <Web3RuntimeProvider>{children}</Web3RuntimeProvider>
    </Suspense>
  );
}
