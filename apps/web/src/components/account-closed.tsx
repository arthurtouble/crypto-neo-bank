"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Download, UserX } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";

/** Fired by `useApi` when the server says the account is closed. */
export const ACCOUNT_CLOSED_EVENT = "aura:account-closed";

/**
 * Once the server says the account is closed, every page but Support shows
 * this instead: the customer can still download their data or contact us.
 */
export function AccountClosedGate({ children }: { children: React.ReactNode }) {
  const [closed, setClosed] = useState(false);
  const pathname = usePathname();
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    const onClosed = () => setClosed(true);
    window.addEventListener(ACCOUNT_CLOSED_EVENT, onClosed);
    return () => window.removeEventListener(ACCOUNT_CLOSED_EVENT, onClosed);
  }, []);
  if (!closed || pathname.startsWith("/app/support")) return <>{children}</>;
  async function exportData() {
    const token = await getAccessToken();
    const response = await fetch("/api/privacy/export", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
    if (!response.ok) return;
    const url = URL.createObjectURL(await response.blob());
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = "aura-data.json"; anchor.click(); URL.revokeObjectURL(url);
  }
  return <section className="panel emptyState" role="alert" data-testid="account-closed">
    <UserX size={22} />
    <strong>This account is closed</strong>
    <span>You can still download your data. If you think this is a mistake, contact support.</span>
    <div className="transactionLinks"><button className="button secondary" onClick={() => void exportData()}><Download size={14} /> Download my data</button>
      <Link className="button secondary" href="/app/support">Contact support</Link></div>
  </section>;
}
