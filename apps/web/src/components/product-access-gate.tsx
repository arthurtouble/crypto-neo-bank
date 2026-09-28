"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { ExampleProduct } from "./example-product";

export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, login, ready } = usePrivy();

  if (!ready) return <ExampleProduct section={pathname?.split("/")[2] ?? "overview"} onSignIn={login} signInReady={false} />;
  if (!authenticated) return <ExampleProduct section={pathname?.split("/")[2] ?? "overview"} onSignIn={login} />;

  return children;
}
