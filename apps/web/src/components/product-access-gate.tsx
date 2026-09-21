"use client";

import { usePrivy } from "@privy-io/react-auth";
import { ArrowRight, LockKeyhole, ShieldCheck, WalletCards } from "lucide-react";
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
        <p className="eyebrow">PRIVATE CLIENT ACCESS</p>
        <h1>Your financial relationship starts with a wallet only you control.</h1>
        <p>Sign in to create or connect a Privy-secured wallet. Aurel never receives your recovery secret and cannot move assets without your confirmation.</p>
        <button className="button primary" onClick={login}>Continue securely <ArrowRight size={16} /></button>
        <div className="accessAssurances">
          <span><ShieldCheck size={15} /> User-confirmed transactions</span>
          <span><WalletCards size={15} /> Exportable wallet</span>
        </div>
      </section>
    );
  }

  return children;
}

