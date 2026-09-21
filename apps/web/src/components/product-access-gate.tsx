"use client";

import { usePrivy } from "@privy-io/react-auth";
import { LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
import { usePathname } from "next/navigation";

export function ProductAccessGate({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const { authenticated, login, ready } = usePrivy();

  if (pathname === "/app/sandbox") return children;

  if (!ready) {
    return <div className="accessState" role="status"><span className="accessPulse" /><p>Establishing a secure session…</p></div>;
  }

  if (!authenticated) {
    return (
      <section className="accessGate">
        <div className="accessGateMark"><LockKeyhole size={24} /></div>
        <p className="eyebrow">Private access</p>
        <h1>Start with a wallet you control.</h1>
        <p>Sign in to create or connect a Privy wallet. Aurel never sees your recovery secret or signs for you.</p>
        <button className="button primary" onClick={login}>Continue securely</button>
        <div className="accessAssurances">
          <span><ShieldCheck size={15} /> User-confirmed transactions</span>
          <span><WalletCards size={15} /> Exportable wallet</span>
        </div>
      </section>
    );
  }

  return children;
}
