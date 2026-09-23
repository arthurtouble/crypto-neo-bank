"use client";

import { usePrivy } from "@privy-io/react-auth";
import { Check, CircleAlert, ExternalLink, LoaderCircle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { SUPPORTED_CHAINS } from "@/config/chains";
import { bridgeProgressDetail, lifecycleCopy, lifecycleStep, normalizeVerifiedIntentStatus, terminalIntentStatuses, type TransactionLifecycleStatus } from "@/lib/transactions/lifecycle";

type IntentState = { status: string; type?: string; verificationState?: string; failureReason?: string | null };
type ObservedState = { intentId: string; status: TransactionLifecycleStatus; failureReason: string | null; detail: string | null };

type Props = {
  action: string;
  status: TransactionLifecycleStatus;
  stage?: string | null;
  error?: string | null;
  intentId?: string | null;
  hashes?: string[];
  chainId?: number;
  submittedDetail?: string;
  onConfirmed?: () => void;
};

function explorerUrl(chainId: number, hash: string) {
  const chain = SUPPORTED_CHAINS.find((item) => item.id === chainId);
  const base = chain?.blockExplorers?.default.url;
  return base ? `${base}/tx/${hash}` : null;
}

export function TransactionProgress({ action, status, stage, error, intentId, hashes = [], chainId = 8453, submittedDetail, onConfirmed }: Props) {
  const { getAccessToken } = usePrivy();
  const [observed, setObserved] = useState<ObservedState | null>(null);
  const onConfirmedRef = useRef(onConfirmed);
  const currentObservation = observed?.intentId === intentId ? observed : null;
  const effectiveStatus = currentObservation?.status ?? status;
  const copy = lifecycleCopy(effectiveStatus, action);
  const currentStep = lifecycleStep(effectiveStatus);
  const links = useMemo(() => hashes.map((hash) => ({ hash, url: explorerUrl(chainId, hash) })).filter((item) => item.url), [chainId, hashes]);

  useEffect(() => { onConfirmedRef.current = onConfirmed; }, [onConfirmed]);

  useEffect(() => {
    if (!intentId || status !== "submitted") return;
    let stopped = false;
    let timer: number | undefined;
    let notified = false;
    const check = async () => {
      try {
        const token = await getAccessToken();
        if (!token || stopped) return;
        await fetch("/api/intents/reconcile", { method: "POST", headers: { Authorization: `Bearer ${token}` } });
        const response = await fetch(`/api/intents/status?intentId=${encodeURIComponent(intentId)}`, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
        if (!response.ok) return;
        const body = await response.json() as IntentState;
        const next = normalizeVerifiedIntentStatus(body.status, body.verificationState);
        if (next) setObserved({ intentId, status: next,
          failureReason: body.status === "confirmed" && body.verificationState !== "confirmed" ? "This historical confirmation lacks independently verified transaction evidence." : body.failureReason ?? null,
          detail: body.type === "bridge" ? bridgeProgressDetail(body.verificationState) : null });
        if (next === "confirmed" && !notified) { notified = true; onConfirmedRef.current?.(); }
        if ((!next || !terminalIntentStatuses.has(next)) && !stopped) timer = window.setTimeout(check, 5_000);
      } catch {
        if (!stopped) timer = window.setTimeout(check, 8_000);
      }
    };
    timer = window.setTimeout(check, 1_500);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [getAccessToken, intentId, status]);

  const failed = effectiveStatus === "failed" || effectiveStatus === "cancelled";
  const complete = effectiveStatus === "confirmed";
  const submitted = effectiveStatus === "submitted";
  return <div className={`transactionProgress ${failed ? "failed" : complete ? "complete" : "active"}`} role={failed ? "alert" : "status"} aria-live="polite">
    <div className="transactionProgressHeadline">
      <span>{failed ? <X size={17} /> : complete ? <Check size={17} /> : submitted ? <Check size={17} /> : <LoaderCircle className="spin" size={17} />}</span>
      <div><strong>{stage || copy.title}</strong><small>{error || currentObservation?.failureReason || currentObservation?.detail || (submitted && submittedDetail) || copy.detail}</small></div>
    </div>
    {!failed && <div className="transactionSteps" aria-label={`${action} progress`}>
      {["Review", "Confirm", "Submitted", "Complete"].map((label, index) => <span className={index <= currentStep ? "done" : ""} key={label}><i>{index < currentStep || complete ? <Check size={10} /> : index + 1}</i>{label}</span>)}
    </div>}
    {failed && <div className="transactionFailureHint"><CircleAlert size={14} /> No retry was started automatically.</div>}
    {links.length > 0 && <div className="transactionLinks">{links.map((item, index) => <a href={item.url!} target="_blank" rel="noreferrer" key={item.hash}>View {links.length > 1 ? `Transaction ${index + 1}` : "Transaction"}<ExternalLink size={12} /></a>)}</div>}
  </div>;
}
