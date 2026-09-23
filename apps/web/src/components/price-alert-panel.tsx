"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { usePrivy } from "@privy-io/react-auth";
import { X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { alertListState, alertRuleLabel, alertStateLabel, validAlertThreshold, type AlertDirection, type AlertStatus } from "@/lib/swap/price-alert-view-model";

type PriceAlert = {
  alertId: string; pairId: "ETH/USD"; baseAssetId: string; quoteAssetId: string; quoteCurrency: "USD"; mappingVersion: string;
  direction: AlertDirection; threshold: string; hysteresisBps: number; cooldownSeconds: number; status: AlertStatus;
  thresholdVersion: number; createdAt: string; updatedAt: string;
};
type AlertResponse = { alerts: PriceAlert[]; planningAvailable: boolean; delivery: "not_active" };
type MutationAction = "pause" | "resume" | "cancel";

function responseError(status: number): string {
  if (status === 409) return "This alert changed elsewhere. Refresh and try again.";
  if (status === 423) return "Your account is locked.";
  if (status === 403) return "Price alerts are unavailable for this account.";
  if (status === 429) return "Too many changes. Try again later.";
  return "Price alerts are unavailable. Try again.";
}

export async function commitAndRefresh(commit: () => Promise<unknown>, refresh: () => Promise<unknown>): Promise<"refreshed" | "refresh_failed"> {
  await commit();
  try { await refresh(); return "refreshed"; }
  catch { return "refresh_failed"; }
}

export function PriceAlertRow({ alert, busy, planningAvailable = true, onEdit, onChange }: {
  alert: PriceAlert; busy: boolean; planningAvailable?: boolean; onEdit(alert: PriceAlert): void; onChange(alert: PriceAlert, action: MutationAction): void;
}) {
  return <li className="priceAlertRow">
    <div><strong>{alertRuleLabel(alert.direction, alert.threshold)}</strong><small>{alertStateLabel(alert.status)}</small></div>
    <div className="priceAlertActions">
      {alert.status === "active" && planningAvailable && <button type="button" disabled={busy} onClick={() => onEdit(alert)}>Edit</button>}
      <button type="button" disabled={busy || (!planningAvailable && alert.status !== "active")} onClick={() => onChange(alert, alert.status === "active" ? "pause" : "resume")}>{alert.status === "active" ? "Pause" : "Resume"}</button>
      <button type="button" disabled={busy} onClick={() => onChange(alert, "cancel")}>Remove</button>
    </div>
  </li>;
}

export function PriceAlertPanel() {
  const { getAccessToken } = usePrivy();
  const newAlertButton = useRef<HTMLButtonElement>(null);
  const [alerts, setAlerts] = useState<PriceAlert[]>([]);
  const [planningAvailable, setPlanningAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [modal, setModal] = useState<"create" | PriceAlert | null>(null);
  const [direction, setDirection] = useState<AlertDirection>("above");
  const [threshold, setThreshold] = useState("");
  const listState = alertListState(loading, loaded, alerts.length);

  const request = useCallback(async (method: "GET" | "POST" | "PATCH", body?: unknown, signal?: AbortSignal) => {
    const token = await getAccessToken();
    if (!token) throw new Error("Sign in to manage alerts.");
    const response = await fetch("/api/swap/alerts", { method, signal, cache: "no-store", headers: {
      Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { "Content-Type": "application/json" })
    }, body: body === undefined ? undefined : JSON.stringify(body) });
    if (!response.ok) throw new Error(responseError(response.status));
    return response.json();
  }, [getAccessToken]);

  const refresh = useCallback(async (signal?: AbortSignal) => {
    const response = await request("GET", undefined, signal) as AlertResponse;
    if (!signal?.aborted) { setAlerts(response.alerts); setPlanningAvailable(response.planningAvailable); setLoaded(true); }
  }, [request]);

  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try { await refresh(controller.signal); }
      catch (caught) { if (!controller.signal.aborted) setError(caught instanceof Error ? caught.message : "Price alerts are unavailable."); }
      finally { if (!controller.signal.aborted) setLoading(false); }
    })();
    return () => controller.abort();
  }, [refresh]);

  function openCreate() { setDirection("above"); setThreshold(""); setError(null); setModal("create"); }
  function openEdit(alert: PriceAlert) { setDirection(alert.direction); setThreshold(alert.threshold); setError(null); setModal(alert); }

  async function save(event: React.FormEvent) {
    event.preventDefault(); setError(null); setNotice(null);
    if (!validAlertThreshold(threshold)) { setError("Enter a price greater than zero, without commas."); return; }
    setBusy(true);
    try {
      if (modal === null) return;
      const outcome = await commitAndRefresh(() => modal === "create"
        ? request("POST", { pairId: "ETH/USD", direction, threshold })
        : request("PATCH", { alertId: modal.alertId, version: modal.thresholdVersion, action: "edit", direction, threshold }), refresh);
      setModal(null);
      setNotice(modal === "create" ? "Alert saved. Price monitoring is not active yet." : "Alert updated. Price monitoring is not active yet.");
      if (outcome === "refresh_failed") setError("Saved, but the list could not refresh. Try again.");
    } catch (caught) { setError(caught instanceof Error ? caught.message : "Could not save alert."); }
    finally { setBusy(false); }
  }

  async function change(alert: PriceAlert, action: MutationAction) {
    if (action === "cancel" && !window.confirm("Remove this price alert?")) return;
    setBusy(true); setError(null); setNotice(null);
    try {
      const outcome = await commitAndRefresh(() => request("PATCH", { alertId: alert.alertId, version: alert.thresholdVersion, action }), refresh);
      setNotice(action === "cancel" ? "Alert removed." : action === "pause" ? "Alert paused." : "Alert resumed. Price monitoring is not active yet.");
      if (outcome === "refresh_failed") setError("Updated, but the list could not refresh. Try again.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not update alert.");
      if (caught instanceof Error && caught.message.includes("changed elsewhere")) await refresh().catch(() => {});
    } finally { setBusy(false); }
  }

  return <section className="priceAlerts" aria-labelledby="priceAlertsTitle">
    <div className="priceAlertsHeading"><div><h3 id="priceAlertsTitle">Price Alerts</h3><p>Save an ETH price threshold to revisit later.</p></div>{planningAvailable && <button ref={newAlertButton} className="button secondary" type="button" onClick={openCreate} disabled={busy}>New Alert</button>}</div>
    <p className="priceAlertsInactive">{planningAvailable ? "Price monitoring and notifications are not active yet. No trade will be placed." : "Price alerts aren’t available for this account yet."}</p>
    {error && <p className="formError" role="alert">{error} <button type="button" onClick={() => { setError(null); setLoading(true); void refresh().catch(() => setError("Price alerts are unavailable. Try again.")).finally(() => setLoading(false)); }}>Try Again</button></p>}
    {notice && <p className="formSuccess" role="status">{notice}</p>}
    {listState === "loading" ? <p role="status">Loading alerts…</p>
      : listState === "empty" ? <p className="priceAlertsEmpty">No saved alerts.</p>
      : listState === "populated" ? <ul className="priceAlertList">{alerts.map((alert) => <PriceAlertRow key={alert.alertId} alert={alert} busy={busy} planningAvailable={planningAvailable} onEdit={openEdit} onChange={(item, action) => void change(item, action)} />)}</ul> : null}
    <Dialog.Root open={modal !== null} onOpenChange={(open) => { if (!open && !busy) setModal(null); }}>
      <Dialog.Portal><Dialog.Overlay className="swapPickerOverlay" /><Dialog.Content className="swapPickerDialog priceAlertDialog" onCloseAutoFocus={(event) => { event.preventDefault(); newAlertButton.current?.focus(); }}>
        <div className="swapPickerHeading"><Dialog.Title>{modal === "create" ? "New Price Alert" : "Edit Price Alert"}</Dialog.Title><Dialog.Close className="swapPickerClose" aria-label="Close" disabled={busy}><X size={18} /></Dialog.Close></div>
        <Dialog.Description>Save an ETH/USD price threshold. Monitoring and notifications are not active yet.</Dialog.Description>
        <form className="priceAlertForm" onSubmit={(event) => void save(event)}>
          <label htmlFor="price-alert-direction">When ETH is</label><select id="price-alert-direction" value={direction} onChange={(event) => setDirection(event.target.value as AlertDirection)}><option value="above">Above</option><option value="below">Below</option></select>
          <label htmlFor="price-alert-threshold">Price in USD</label><input id="price-alert-threshold" inputMode="decimal" autoComplete="off" value={threshold} onChange={(event) => setThreshold(event.target.value)} placeholder="2500" required aria-invalid={Boolean(error && !validAlertThreshold(threshold))} />
          {error && <p className="formError" role="alert">{error}</p>}
          <button className="button primary full" disabled={busy || !validAlertThreshold(threshold)}>{busy ? "Saving…" : "Save Alert"}</button>
        </form>
      </Dialog.Content></Dialog.Portal>
    </Dialog.Root>
  </section>;
}
