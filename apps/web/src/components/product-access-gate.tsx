"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { ActivityWorkspace } from "./activity-workspace";
import { CardWorkspace } from "./card-workspace";
import { Dashboard } from "./dashboard";
import { DepositPage } from "./deposit-page";
import { EarnWorkspace } from "./earn-workspace";
import { InsightsWorkspace } from "./insights-workspace";
import { SendPage } from "./send-page";
import { SwapPage } from "./swap-page";
import { ExampleProduct } from "./example-product";

export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, login, ready } = usePrivy();

  const section = pathname?.split("/")[2] ?? "overview";
  // Rebuilt sections render their own labelled example data; the rest use the shared example page until they're rebuilt.
  if (!authenticated && section === "overview") return <Dashboard />;
  if (!authenticated && section === "deposit") return <DepositPage />;
  if (!authenticated && section === "send") return <SendPage />;
  if (!authenticated && section === "swap") return <SwapPage />;
  if (!authenticated && section === "earn") return <EarnWorkspace />;
  if (!authenticated && section === "cards") return <CardWorkspace />;
  if (!authenticated && section === "transactions") return <ActivityWorkspace />;
  if (!authenticated && section === "insights") return <InsightsWorkspace />;
  if (!ready) return <ExampleProduct section={section} onSignIn={login} signInReady={false} />;
  if (!authenticated) return <ExampleProduct section={section} onSignIn={login} />;

  return children;
}
