"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Download, LoaderCircle, MailX, Trash2 } from "lucide-react";
import { useState } from "react";

export function DataRightsPanel() {
  const { getAccessToken } = usePrivy();
  const [working, setWorking] = useState<"export" | "delete" | "marketing" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function request(requestType: "export" | "delete") {
    if (requestType === "delete" && !window.confirm("Request deletion of your growth and application data? Product access and financial records are handled separately.")) return;
    setWorking(requestType); setMessage(null);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/growth/data-requests", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ requestType }) });
      if (!response.ok) throw new Error("Your request could not be received.");
      setMessage("Request received. We’ll confirm when it is complete.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your request could not be received."); }
    finally { setWorking(null); }
  }
  async function withdrawMarketing() {
    setWorking("marketing"); setMessage(null);
    try { const token = await getAccessToken(); const response = await fetch("/api/growth/consent", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ purpose: "marketing", action: "withdrawn", noticeVersion: "2026-09-22" }) }); if (!response.ok) throw new Error("Your preference could not be updated."); setMessage("Product updates are off."); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Your preference could not be updated."); }
    finally { setWorking(null); }
  }
  return <section className="panel settingsPanel dataRightsPanel"><h2>Data & Privacy</h2><div className="settingRow"><span className="settingIcon"><MailX size={17} /></span><div><strong>Product Updates</strong></div><button disabled={Boolean(working)} onClick={() => void withdrawMarketing()}>{working === "marketing" ? <LoaderCircle className="spin" size={15} /> : "Turn Off"}</button></div><div className="settingRow"><span className="settingIcon"><Download size={17} /></span><div><strong>Export Growth Data</strong></div><button disabled={Boolean(working)} onClick={() => void request("export")}>{working === "export" ? <LoaderCircle className="spin" size={15} /> : "Request"}</button></div><div className="settingRow"><span className="settingIcon"><Trash2 size={17} /></span><div><strong>Delete Growth Data</strong></div><button disabled={Boolean(working)} onClick={() => void request("delete")}>{working === "delete" ? <LoaderCircle className="spin" size={15} /> : "Request"}</button></div>{message && <p className="settingsMessage" role="status">{message}</p>}</section>;
}
