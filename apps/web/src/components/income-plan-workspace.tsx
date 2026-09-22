"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { BriefcaseBusiness, Check, CirclePause, LoaderCircle, Pencil, PiggyBank, X } from "lucide-react";
import { useState } from "react";
import { allocationIsValid, allocationPreview, allocationTotal, type IncomeAllocation } from "@/lib/income/allocation";

type Plan = IncomeAllocation & { planId: string; mode: "next_income" | "recurring"; status: "draft" | "paused"; updatedAt: string };
type PlanResponse = { plan: Plan | null; authority: string; activation: string };

export function IncomePlanWorkspace({ bankAccountActive, onBankSetup }: { bankAccountActive: boolean; onBankSetup: () => void }) {
  const { user, getAccessToken } = usePrivy();
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"next_income" | "recurring">("recurring");
  const [allocation, setAllocation] = useState<IncomeAllocation>({ spendingPercent: 70, goalsPercent: 20, earnPercent: 10 });
  const [previewAmount, setPreviewAmount] = useState("4000");
  const [error, setError] = useState<string | null>(null);
  const query = useQuery<PlanResponse>({
    queryKey: ["income-plan", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/income-plan", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Your payday plan is unavailable.");
      return response.json();
    },
    enabled: Boolean(user)
  });
  const plan = query.data?.plan ?? null;

  const save = useMutation({
    mutationFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/income-plan", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ mode, ...allocation }) });
      const body = await response.json() as { message?: string };
      if (!response.ok) throw new Error(body.message ?? "The plan could not be saved.");
    },
    onSuccess: async () => { await queryClient.invalidateQueries({ queryKey: ["income-plan", user?.id] }); setOpen(false); },
    onError: (caught) => setError(caught instanceof Error ? caught.message : "The plan could not be saved.")
  });
  const update = useMutation({
    mutationFn: async (action: "pause" | "resume" | "archive") => {
      if (!plan) return;
      const token = await getAccessToken();
      const response = await fetch("/api/income-plan", { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ planId: plan.planId, action }) });
      if (!response.ok) throw new Error("The plan could not be updated.");
    },
    onSuccess: async () => queryClient.invalidateQueries({ queryKey: ["income-plan", user?.id] })
  });

  function editPlan() {
    if (plan) {
      setMode(plan.mode);
      setAllocation({ spendingPercent: plan.spendingPercent, goalsPercent: plan.goalsPercent, earnPercent: plan.earnPercent });
    }
    setError(null);
    setOpen(true);
  }

  const total = allocationTotal(allocation);
  const preview = allocationPreview(Number(previewAmount), allocation);
  const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 0 });
  return <section className="panel paydayPanel">
    <div className="panelHeading"><div><h2>Paycheck</h2></div><span className={`statusBadge ${bankAccountActive ? "good" : "neutral"}`}>{bankAccountActive ? "Bank Account Ready" : "Setup Required"}</span></div>
    <div className="paydayGrid">
      <article className="directDepositCard"><span><BriefcaseBusiness size={19} /></span><div><h3>Direct Deposit</h3><p>{bankAccountActive ? "Share your account details with your employer or payroll provider." : "Set up bank transfers before using Aurel for payroll."}</p></div><button className="button secondary" onClick={onBankSetup}>{bankAccountActive ? "Account Details" : "Set Up"}</button></article>
      <article className="incomePlanCard"><div className="incomePlanHeader"><span><PiggyBank size={19} /></span><div><h3>Payday Plan</h3><p>Choose how incoming pay should be organized.</p></div>{plan && <button className="iconButton" aria-label="Edit payday plan" onClick={editPlan}><Pencil size={15} /></button>}</div>
        {query.isPending ? <div className="emptyState compact"><LoaderCircle className="spin" size={16} /> Loading…</div> : !plan ? <button className="button primary" onClick={editPlan}>Plan Allocations</button> : <><div className="incomeAllocationBars"><span style={{ "--share": `${plan.spendingPercent}%` } as React.CSSProperties}><i />Available<strong>{plan.spendingPercent}%</strong></span><span style={{ "--share": `${plan.goalsPercent}%` } as React.CSSProperties}><i />Goals<strong>{plan.goalsPercent}%</strong></span><span style={{ "--share": `${plan.earnPercent}%` } as React.CSSProperties}><i />Earn<strong>{plan.earnPercent}%</strong></span></div><div className="incomePlanFoot"><span>{plan.mode === "recurring" ? "Every paycheck" : "Next paycheck"} · Draft only</span><button onClick={() => void update.mutateAsync(plan.status === "paused" ? "resume" : "pause")} disabled={update.isPending}>{plan.status === "paused" ? <Check size={13} /> : <CirclePause size={13} />}{plan.status === "paused" ? "Resume" : "Pause"}</button></div></>}
      </article>
    </div>
    <p className="authorityFootnote">A Payday Plan is a preference, not an instruction to move money. Activation requires bank setup and a separate provider-backed mandate.</p>

    {open && <div className="modalBackdrop" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="financialModal incomePlanModal" role="dialog" aria-modal="true" aria-labelledby="income-plan-title"><button className="modalClose" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button><h2 id="income-plan-title">Plan Your Paycheck</h2><p>Save a draft now. Nothing moves until the required services are connected and you approve activation.</p>
      <div className="segmentedControl"><button type="button" className={mode === "recurring" ? "active" : ""} onClick={() => setMode("recurring")}>Every Paycheck</button><button type="button" className={mode === "next_income" ? "active" : ""} onClick={() => setMode("next_income")}>Next Paycheck</button></div>
      <div className="incomePlanFields">
        <label className="fieldLabel">Available to Spend<input type="number" min="0" max="100" inputMode="numeric" value={allocation.spendingPercent} onChange={(event) => setAllocation((current) => ({ ...current, spendingPercent: Number(event.target.value) }))} /><small>%</small></label>
        <label className="fieldLabel">Goals<input type="number" min="0" max="100" inputMode="numeric" value={allocation.goalsPercent} onChange={(event) => setAllocation((current) => ({ ...current, goalsPercent: Number(event.target.value) }))} /><small>%</small></label>
        <label className="fieldLabel">Earn<input type="number" min="0" max="100" inputMode="numeric" value={allocation.earnPercent} onChange={(event) => setAllocation((current) => ({ ...current, earnPercent: Number(event.target.value) }))} /><small>%</small></label>
      </div>
      <div className={`allocationTotal ${total === 100 ? "valid" : "invalid"}`}><span>Total</span><strong>{total}%</strong></div>
      <label className="fieldLabel previewPaycheck">Preview Paycheck<input inputMode="decimal" value={previewAmount} onChange={(event) => setPreviewAmount(event.target.value)} /></label>
      {preview && <div className="transactionSummary"><span>Available<strong>{money.format(preview.spending)}</strong></span><span>Goals<strong>{money.format(preview.goals)}</strong></span><span>Earn<strong>{money.format(preview.earn)}</strong></span></div>}
      {allocation.earnPercent > 0 && <div className="modalRisk">Earn allocations require eligible markets, a current quote, risk disclosures, and separate authorization before they can activate.</div>}
      {error && <div className="formError" role="alert">{error}</div>}
      <button className="button primary full" disabled={!allocationIsValid(allocation) || save.isPending} onClick={() => save.mutate()}>{save.isPending ? <LoaderCircle className="spin" size={15} /> : null}Save Draft</button>
    </section></div>}
  </section>;
}
