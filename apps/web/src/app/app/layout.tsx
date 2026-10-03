import type { Metadata } from "next";
// Area stylesheets only the app renders; the root layout loads the tokens, the shell, and the public pages' styles first.
import "../overview.css";
import "../money.css";
import "../cards.css";
import "../records.css";
import "../settings.css";
import "../markets.css";
import "../predictions.css";
import { AppShell } from "@/components/app-shell";
import { AuthProvider } from "@/components/auth-provider";
import { ProductAnalytics } from "@/components/product-analytics";
import { TermsGate } from "@/components/terms-gate";

// The app shows example data or a customer's own: never a search result. robots.txt leaves /app crawlable so search
// engines can read this (lib/site/seo.ts).
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ProductAnalytics /><AppShell><TermsGate>{children}</TermsGate></AppShell></AuthProvider>;
}
