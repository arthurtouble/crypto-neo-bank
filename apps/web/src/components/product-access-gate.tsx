"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { customerSections, type CustomerSection } from "@/lib/product-map";
import { Dashboard } from "./dashboard";
import { SectionPage } from "./section-page";

/**
 * Guests (and everyone until Privy knows who they are) see each section's own page, which labels its fictional
 * example data and turns every action into sign-in. Signed-in customers get the route's page.
 */
export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated } = usePrivy();
  const section = pathname?.split("/")[2] ?? "overview";
  if (authenticated) return children;
  if (section === "overview") return <Dashboard />;
  if (customerSections.includes(section as CustomerSection)) return <SectionPage section={section as CustomerSection} />;
  return children;
}
