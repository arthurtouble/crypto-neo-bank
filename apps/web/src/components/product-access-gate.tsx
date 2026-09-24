"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { ExampleProduct } from "./example-product";

export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, login, ready } = usePrivy();

  if (pathname === "/app/sandbox") return children;

  if (!ready) {
    return <div className="accessState" role="status"><span className="accessPulse" /><p>Establishing a secure session…</p></div>;
  }

  if (!authenticated && pathname === "/app/operations") return <div className="accessGate">Sign in for authorized operations.</div>;
  if (!authenticated) return <ExampleProduct section={pathname?.split("/")[2] ?? "overview"} onSignIn={login} />;

  return children;
}
