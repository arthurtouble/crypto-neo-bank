import { AppShell } from "@/components/app-shell";
import { ProductAccessGate } from "@/components/product-access-gate";
import { AuthProvider } from "@/components/auth-provider";
import { ProductAnalytics } from "@/components/product-analytics";
import { BetaAccessGate } from "@/components/beta-access-gate";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ProductAnalytics /><AppShell><ProductAccessGate><BetaAccessGate>{children}</BetaAccessGate></ProductAccessGate></AppShell></AuthProvider>;
}
