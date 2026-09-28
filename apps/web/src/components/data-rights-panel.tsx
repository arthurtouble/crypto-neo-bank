"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, Mail } from "lucide-react";
import { useState } from "react";
import { marketingNoticeVersion } from "@/lib/legal/documents";
import { useToast } from "./toast";

type ConsentResponse = { consent: { marketing: boolean } };

export function DataRightsPanel() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [working, setWorking] = useState<"export" | "marketing" | null>(null);
  const toast = useToast();
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error("Your request could not be completed.");
    return response.json() as Promise<T>;
  }
  const consent = useQuery<ConsentResponse>({ queryKey: ["consent", user?.id], queryFn: () => call<ConsentResponse>("/api/privacy/consent"), enabled: Boolean(user) });
  /** The customer's data downloads straight away as JSON. */
  async function exportData() {
    setWorking("export");
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/privacy/export", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error(response.status === 429 ? "You've downloaded your data several times today. Try again tomorrow." : "Your data couldn't be exported. Try again.");
      const url = URL.createObjectURL(await response.blob());
      const anchor = document.createElement("a"); anchor.href = url; anchor.download = `aura-data-${new Date().toISOString().slice(0, 10)}.json`; anchor.click(); URL.revokeObjectURL(url);
      toast.success("Your data is downloading");
    } catch (error) { toast.error("Export failed", error instanceof Error ? error.message : undefined); }
    finally { setWorking(null); }
  }
  async function setMarketing(granted: boolean) {
    setWorking("marketing");
    try {
      await call("/api/privacy/consent", { purpose: "marketing", action: granted ? "granted" : "withdrawn", noticeVersion: marketingNoticeVersion });
      client.setQueryData(["consent", user?.id], { consent: { marketing: granted } });
      toast.success(granted ? "Product update emails are on" : "Product update emails are off");
    } catch (error) { toast.error("Choice not saved", error instanceof Error ? error.message : undefined); }
    finally { setWorking(null); }
  }
  const marketing = consent.data?.consent.marketing ?? false;
  return <section className="panel settingsPanel dataRightsPanel"><h2>Data and privacy</h2>
    <div className="settingRow"><span className="settingIcon"><Mail size={17} /></span><div><strong>Product update emails</strong><small>Occasional news about Aura. Off unless you turn it on.</small></div>
      <button className={`settingsToggle ${marketing ? "active" : ""}`} aria-pressed={marketing} disabled={Boolean(working) || !consent.data} onClick={() => void setMarketing(!marketing)}>
        {working === "marketing" ? <LoaderCircle className="spin" size={15} /> : marketing ? "On" : "Off"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Download size={17} /></span><div><strong>Download my data</strong><small>A copy of everything Aura holds about you, as a file.</small></div>
      <button disabled={Boolean(working)} onClick={() => void exportData()}>{working === "export" ? <LoaderCircle className="spin" size={15} /> : "Download"}</button></div>
    <p className="settingsMessage">Aura keeps your transaction, security, and consent records. To close your account, move your money out and contact support.</p></section>;
}
