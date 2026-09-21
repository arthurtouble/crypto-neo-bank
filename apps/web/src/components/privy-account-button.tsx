"use client";

import { lazy, Suspense } from "react";

const PrivyAccountRuntime = lazy(() => import("./privy-account-runtime"));

export function PrivyAccountButton() {
  return (
    <Suspense fallback={<button className="headerAvatar" aria-label="Loading account" disabled>AM</button>}>
      <PrivyAccountRuntime />
    </Suspense>
  );
}
