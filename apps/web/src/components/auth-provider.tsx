"use client";

import { LoaderCircle } from "lucide-react";
import { lazy, Suspense } from "react";

const Web3RuntimeProvider = lazy(() => import("./web3-runtime-provider"));

export function AuthProvider({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="appLoading" role="status"><LoaderCircle className="spin" aria-hidden="true" /><p>Getting your wallet ready</p></div>}>
      <Web3RuntimeProvider>{children}</Web3RuntimeProvider>
    </Suspense>
  );
}
