"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Download, LoaderCircle, UserX } from "lucide-react";
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
  const [downloading, setDownloading] = useState(false);
  const [error, setError] = useState("");
  const pathname = usePathname();
  const { getAccessToken } = usePrivy();
  useEffect(() => {
    const onClosed = () => setClosed(true);
    window.addEventListener(ACCOUNT_CLOSED_EVENT, onClosed);
    return () => window.removeEventListener(ACCOUNT_CLOSED_EVENT, onClosed);
  }, []);
  if (!closed || pathname.startsWith("/app/support")) return <>{children}</>;
  async function exportData() {
    setDownloading(true); setError("");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/privacy/export", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("export failed");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = "aura-data.json"; anchor.click(); URL.revokeObjectURL(url);
    } catch {
      setError("We couldn't download your data. Try again, or contact support.");
    } finally { setDownloading(false); }
  }
  return <div className="mxPage">
    <section className="mxCard appBlocked" role="alert" data-testid="account-closed" aria-labelledby="account-closed-title">
      <span className="appIconDisc" aria-hidden="true"><UserX /></span>
      <h1 id="account-closed-title">This account is closed</h1>
      <p>You can still download your data. If you think this is a mistake, contact support.</p>
      <div className="mxActions">
        <button type="button" className="appButton" disabled={downloading} onClick={() => void exportData()}>
          {downloading ? <LoaderCircle className="spin" aria-hidden="true" /> : <Download aria-hidden="true" />} Download my data</button>
        <Link className="appButton appButtonPrimary" href="/app/support">Contact support</Link>
      </div>
      {error && <p className="appFieldError" aria-live="polite">{error}</p>}
    </section>
  </div>;
}
