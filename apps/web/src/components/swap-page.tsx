"use client";

import { useAuth } from "@/lib/client/auth";
import { MoneyPage, SignedOutPanel } from "./money-page";
import { SwapWorkspace } from "./swap-workspace";
import { LoadingState } from "./states";

/**
 * Swap (journey J7): what you pay and what you receive, then a quote with its countdown, fees, and reference prices,
 * then the passkey. The quote sits beside the form on desktop and below it on the phone.
 */
export function SwapPage() {
  const { authenticated, ready, login } = useAuth();
  const isExample = ready && !authenticated;
  return <MoneyPage title="Swap" guest={isExample || !ready} onSignIn={login} ready={ready}>
    {!ready ? <LoadingState><strong>Setting up your account</strong></LoadingState>
      : isExample ? <SignedOutPanel title="Swap assets" ariaLabel="Swap form" action="Sign in to swap" onSignIn={login}>
        Buy and sell crypto, stocks, and gold, or move money to another network. You see what you get and what it costs before you confirm with your passkey.</SignedOutPanel>
        : <SwapWorkspace />}
  </MoneyPage>;
}
