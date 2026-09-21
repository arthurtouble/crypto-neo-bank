import { AppShell } from "@/components/app-shell";
import { ProductAccessGate } from "@/components/product-access-gate";

export default function ProductLayout({ children }: { children: React.ReactNode }) {
  return <AppShell><ProductAccessGate>{children}</ProductAccessGate></AppShell>;
}
