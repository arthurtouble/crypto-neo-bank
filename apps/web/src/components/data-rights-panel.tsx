"use client";

import { useAuth } from "@/lib/client/auth";
import { LoaderCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { SettingRow } from "./setting-row";
import { useToast } from "./toast";

/** The customer's data and account: download everything, read the documents, or ask to close the account. */
export function DataRightsPanel() {
  const { getAccessToken } = useAuth();
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
  return <section className="mxCard stCard" aria-labelledby="account-heading"><h2 id="account-heading">Your data and account</h2>
    <SettingRow title="Download my data" detail="A copy of everything Aura holds about you, as a file.">
      <button type="button" className="appButton" disabled={working} onClick={() => void exportData()}>{working ? <LoaderCircle className="spin" aria-hidden="true" /> : "Download"}</button></SettingRow>
    <SettingRow title="Terms and privacy" detail="The documents you accepted, and how Aura uses your data."><Link className="appButton" href="/docs">Open</Link></SettingRow>
    <SettingRow title="Close your account" detail="Move your money out first, then contact support. We close accounts with no funds left.">
      <Link className="appButton" href="/app/support?topic=close-account">Contact support</Link></SettingRow>
  </section>;
}
