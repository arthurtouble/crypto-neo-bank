"use client";

import { usePrivy } from "@privy-io/react-auth";
import { usePathname } from "next/navigation";
import { ExampleProduct } from "./example-product";

export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, login, ready } = usePrivy();

  if (pathname === "/app/sandbox") return children;

  if (!ready && pathname === "/app/operations") return <div className="accessGate">Sign in for authorized operations.</div>;
  if (!ready) return <ExampleProduct section={pathname?.split("/")[2] ?? "overview"} onSignIn={login} signInReady={false} />;
  if (!authenticated && pathname === "/app/operations") return <div className="accessGate">Sign in for authorized operations.</div>;
  if (!authenticated) return <ExampleProduct section={pathname?.split("/")[2] ?? "overview"} onSignIn={login} />;

  return children;
}
