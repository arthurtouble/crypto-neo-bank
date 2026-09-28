"use client";

import { usePrivy } from "@privy-io/react-auth";
import { BookOpen, Download, LoaderCircle, UserX } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useToast } from "./toast";

/** The customer's data and account: download everything, read the documents, or ask to close the account. */
export function DataRightsPanel() {
  const { getAccessToken } = usePrivy();
  const [working, setWorking] = useState(false);
  const toast = useToast();
  /** The customer's data downloads straight away as JSON. */
  async function exportData() {
    setWorking(true);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/privacy/export", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429 ? "You've downloaded your data several times today. Try again tomorrow." : "Your data couldn't be exported. Try again.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `aura-data-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
      toast.success("Your data is downloading");
    } catch (error) { toast.error("Export failed", error instanceof Error ? error.message : undefined); }
    finally { setWorking(false); }
  }
  return <section className="panel settingsPanel dataRightsPanel" aria-labelledby="account-heading"><h2 id="account-heading">Your data and account</h2>
    <div className="settingRow"><span className="settingIcon"><Download size={17} /></span><div><strong>Download my data</strong><small>A copy of everything Aura holds about you, as a file.</small></div>
      <button disabled={working} onClick={() => void exportData()}>{working ? <LoaderCircle className="spin" size={15} /> : "Download"}</button></div>
    <div className="settingRow"><span className="settingIcon"><BookOpen size={17} /></span><div><strong>Terms and privacy</strong><small>The documents you accepted, and how Aura uses your data.</small></div><Link href="/docs">Open</Link></div>
    <div className="settingRow"><span className="settingIcon"><UserX size={17} /></span><div><strong>Close your account</strong><small>Move your money out first, then contact support. We close accounts with no funds left.</small></div><Link href="/app/support?topic=close-account">Contact support</Link></div>
  </section>;
}
