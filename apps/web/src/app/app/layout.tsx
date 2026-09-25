import { AppShell } from "@/components/app-shell";
import { ProductAccessGate } from "@/components/product-access-gate";
import { AuthProvider } from "@/components/auth-provider";
import { ProductAnalytics } from "@/components/product-analytics";
import { TermsGate } from "@/components/terms-gate";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ProductAnalytics /><AppShell><ProductAccessGate><TermsGate>{children}</TermsGate></ProductAccessGate></AppShell></AuthProvider>;
}
