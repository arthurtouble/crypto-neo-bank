import { AppShell } from "@/components/app-shell";
import { ProductAccessGate } from "@/components/product-access-gate";
import { AuthProvider } from "@/components/auth-provider";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AuthProvider><AppShell><ProductAccessGate>{children}</ProductAccessGate></AppShell></AuthProvider>;
}
