"use client";

import { lazy, Suspense } from "react";

const Web3RuntimeProvider = lazy(() => import("./web3-runtime-provider"));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="accessState" role="status"><span className="accessPulse" /><p>Getting your wallet ready…</p></div>}>
      <Web3RuntimeProvider>{children}</Web3RuntimeProvider>
    </Suspense>
  );
}
