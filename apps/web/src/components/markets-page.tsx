"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/client/auth";
import { MoneyPage } from "./money-page";
import { PerpsHome } from "./perps-home";
import { PredictionsHome } from "./predictions-home";
import { Segmented } from "./markets-parts";

type View = "perps" | "predictions";

/**
 * Markets: perpetual futures on Hyperliquid and prediction markets on
 * Polymarket, each in its own tab. The customer's wallet owns both accounts;
 * Aura takes no fee. Guests see labelled example data.
 */
export function MarketsPage() {
  const { authenticated, ready, login } = useAuth();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname() ?? "/app/markets";
  const view: View = params?.get("view") === "predictions" ? "predictions" : "perps";
  const choose = (next: View) => router.replace(next === "perps" ? pathname : `${pathname}?view=${next}`, { scroll: false });
  return <MoneyPage title="Markets" guest={(ready && !authenticated) || !ready} onSignIn={login} ready={ready} className="mkPage">
    <Segmented label="Markets" value={view} onChange={choose} className="mkViews"
      options={[{ value: "perps", label: "Perps" }, { value: "predictions", label: "Predictions" }]} />
    {view === "perps" ? <PerpsHome /> : <PredictionsHome />}
    <p className="mxHint mkRisk">Perps trade on Hyperliquid and predictions on Polymarket, not on Aura. Your wallet owns both accounts, and Aura charges no fee. You can lose what you put in.</p>
  </MoneyPage>;
}
