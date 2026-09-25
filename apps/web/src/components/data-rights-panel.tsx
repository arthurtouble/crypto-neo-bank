"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Download, LoaderCircle, Mail, Trash2 } from "lucide-react";
import { useState } from "react";
import { marketingNoticeVersion } from "@/lib/legal/documents";

type ConsentResponse = { consent: { marketing: boolean } };
type RequestsResponse = { requests: Array<{ request_id: string; request_type: "export" | "delete"; status: string; requested_at: string }> };

export function DataRightsPanel() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [working, setWorking] = useState<"export" | "delete" | "marketing" | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  async function call<T>(path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken();
    const response = await fetch(path, { method: body ? "POST" : "GET", cache: "no-store",
      headers: { ...(body ? { "Content-Type": "application/json" } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    if (!response.ok) throw new Error("Your request could not be completed.");
    return response.json() as Promise<T>;
  }
  const consent = useQuery<ConsentResponse>({ queryKey: ["consent", user?.id], queryFn: () => call<ConsentResponse>("/api/privacy/consent"), enabled: Boolean(user) });
  const requests = useQuery<RequestsResponse>({ queryKey: ["data-requests", user?.id], queryFn: () => call<RequestsResponse>("/api/privacy/data-requests"), enabled: Boolean(user) });
  async function request(requestType: "export" | "delete") {
    if (requestType === "delete" && !window.confirm("Delete your preferences, analytics, feedback, public Aura tag, and rebuildable account history? Transaction, security, consent, and support records are kept where the law or safety requires. Your wallet and funds are not affected.")) return;
    setWorking(requestType); setMessage(null);
    try {
      await call("/api/privacy/data-requests", { requestType });
      setMessage(requestType === "export" ? "Export requested. We’ll send your data when it is ready." : "Deletion requested. We’ll confirm when it is complete.");
      await client.invalidateQueries({ queryKey: ["data-requests", user?.id] });
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your request could not be received."); }
    finally { setWorking(null); }
  }
  async function setMarketing(granted: boolean) {
    setWorking("marketing"); setMessage(null);
    try {
      await call("/api/privacy/consent", { purpose: "marketing", action: granted ? "granted" : "withdrawn", noticeVersion: marketingNoticeVersion });
      client.setQueryData(["consent", user?.id], { consent: { marketing: granted } });
      setMessage(granted ? "Product update emails are on." : "Product update emails are off.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Your choice could not be saved."); }
    finally { setWorking(null); }
  }
  const marketing = consent.data?.consent.marketing ?? false;
  const pending = requests.data?.requests.find((item) => item.status === "received" || item.status === "processing");
  return <section className="panel settingsPanel dataRightsPanel"><h2>Data & Privacy</h2>
    <div className="settingRow"><span className="settingIcon"><Mail size={17} /></span><div><strong>Product update emails</strong><small>Occasional news about Aura. Off unless you turn it on.</small></div>
      <button className={`settingsToggle ${marketing ? "active" : ""}`} aria-pressed={marketing} disabled={Boolean(working) || !consent.data} onClick={() => void setMarketing(!marketing)}>
        {working === "marketing" ? <LoaderCircle className="spin" size={15} /> : marketing ? "On" : "Off"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Download size={17} /></span><div><strong>Export my data</strong><small>A copy of the personal data Aura holds about you.</small></div>
      <button disabled={Boolean(working)} onClick={() => void request("export")}>{working === "export" ? <LoaderCircle className="spin" size={15} /> : "Request"}</button></div>
    <div className="settingRow"><span className="settingIcon"><Trash2 size={17} /></span><div><strong>Delete my data</strong><small>Records we must keep are listed in the privacy notice.</small></div>
      <button disabled={Boolean(working)} onClick={() => void request("delete")}>{working === "delete" ? <LoaderCircle className="spin" size={15} /> : "Request"}</button></div>
    {pending ? <p className="settingsMessage">Your {pending.request_type} request from {new Date(pending.requested_at).toLocaleDateString()} is in progress.</p> : null}
    {message && <p className="settingsMessage" role="status">{message}</p>}</section>;
}
