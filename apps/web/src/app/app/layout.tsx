import { AppShell } from "@/components/app-shell";
import { ProductAccessGate } from "@/components/product-access-gate";
import { AuthProvider } from "@/components/auth-provider";
import { ProductAnalytics } from "@/components/product-analytics";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ProductAnalytics /><AppShell><ProductAccessGate>{children}</ProductAccessGate></AppShell></AuthProvider>;
}
