"use client";

import { useAuth } from "@/lib/client/auth";
import { MoneyPage } from "./money-page";
import { PerpsHome } from "./perps-home";
import { PredictionsHome } from "./predictions-home";

/**
 * The Perps and Predictions sections (until 3 October 2026 one Markets
 * section with two tabs). The customer's wallet owns the account at each
 * venue; Aura takes no fee. Guests see labelled example data.
 */
export function PerpsPage() {
  const { authenticated, ready, login } = useAuth();
  return <MoneyPage title="Perps" guest={(ready && !authenticated) || !ready} onSignIn={login} ready={ready} className="mkPage">
    <PerpsHome />
    <p className="mxHint mkRisk">Perps trade on Hyperliquid, from an account your wallet owns. Aura charges no fee. With leverage, a small price move can lose everything you put in.</p>
  </MoneyPage>;
}

export function PredictionsPage() {
  const { authenticated, ready, login } = useAuth();
  return <MoneyPage title="Predictions" guest={(ready && !authenticated) || !ready} onSignIn={login} ready={ready} className="mkPage">
    <PredictionsHome />
    <p className="mxHint mkRisk">Predictions trade on Polymarket, from an account your wallet owns. Aura charges no fee. You can lose what you put in.</p>
  </MoneyPage>;
}
