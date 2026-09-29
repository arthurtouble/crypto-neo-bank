"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LoaderCircle } from "lucide-react";
import { GuestBanner } from "./guest-banner";
import { SwapWorkspace } from "./swap-workspace";

/**
 * Swap (journey J7): what you pay and what you receive, then a quote with its countdown, fees, and reference prices,
 * then the passkey. The quote sits beside the form on desktop and below it on the phone.
 */
export function SwapPage() {
  const { authenticated, ready, login } = usePrivy();
  const isExample = ready && !authenticated;
  return <div className="mxPage">
    {(isExample || !ready) && <GuestBanner onSignIn={login} ready={ready} />}
    <header className="mxHead"><h1>Swap</h1></header>
    {!ready ? <div className="mxState" role="status"><LoaderCircle className="spin" aria-hidden="true" /><strong>Setting up your account</strong></div>
      : isExample ? <section className="mxPanel" aria-label="Swap form">
        <div className="mxPanelHead"><h2>Swap assets</h2>
          <p>Exchange assets or move them to another network. You see what you get, the fees, and the price impact before you confirm with your passkey.</p></div>
        <button type="button" className="appButton appButtonPrimary appButtonLarge" onClick={login}>Sign in to swap</button>
      </section>
        : <SwapWorkspace />}
  </div>;
}
