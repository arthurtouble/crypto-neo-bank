"use client";

import { useAuthorizationSignature, useMfaEnrollment, useWallets } from "@privy-io/react-auth";
import { useCallback } from "react";
import type { AuthorizationRequest } from "@/lib/actions/privy-relay";

/**
 * The customer's Aura account: their Privy embedded wallet. Actions are
 * signed as Privy requests that Aura's server relays with gas paid, so the
 * browser only ever approves the exact request the server built. The server
 * makes the same choice of wallet (`requireActionAccount`).
 */
export function useAuraWallet() {
  const { wallets } = useWallets();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const { showMfaEnrollmentModal } = useMfaEnrollment();
  const embedded = wallets.find((wallet) => wallet.walletClientType === "privy");
  const address = embedded?.address.toLowerCase() as `0x${string}` | undefined;

  /** Approve a Privy request with the customer's authorization key and return the signature. */
  const authorize = useCallback(async (request: AuthorizationRequest<unknown>): Promise<string> =>
    (await generateAuthorizationSignature(request)).signature, [generateAuthorizationSignature]);

  return { address, ready: Boolean(address), authorize, enrollPasskey: showMfaEnrollmentModal };
}
