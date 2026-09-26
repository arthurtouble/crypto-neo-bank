"use client";

// Stands in for @privy-io/react-auth/smart-wallets in end-to-end tests. No
// customer in the tests has a previous smart-wallet account.
import { createElement, Fragment, type ReactNode } from "react";

export const useSmartWallets = () => ({ client: undefined, getClientForChain: async () => undefined });
export function SmartWalletsProvider({ children }: { children: ReactNode }) {
  return createElement(Fragment, null, children);
}
