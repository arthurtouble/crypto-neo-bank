"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, CirclePause, LoaderCircle, Plus, Target, X } from "lucide-react";
import { FormEvent, useState } from "react";

type Goal = { goalId: string; name: string; targetAmount: string; targetAsset: "USD" | "USDC"; targetDate?: string; currentAmount: null; status: "active" | "paused" };
const minimumGoalDate = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);

export function GoalsWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const client = useQueryClient();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const query = useQuery<{ goals: Goal[] }>({
    queryKey: ["goals", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/goals", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Goals could not be loaded.");
      return response.json();
    }, enabled: Boolean(user)
  });
  const update = useMutation({ mutationFn: async ({ goalId, action }: { goalId: string; action: "pause" | "resume" }) => {
    const token = await getAccessToken();
    const response = await fetch("/api/goals", { method: "PATCH", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ goalId, action }) });
    if (!response.ok) throw new Error("Goal could not be updated.");
  }, onSuccess: () => client.invalidateQueries({ queryKey: ["goals"] }) });

  async function create(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError("");
    const form = new FormData(event.currentTarget);
    const token = await getAccessToken();
    const response = await fetch("/api/goals", { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ name: form.get("name"), targetAmount: form.get("targetAmount"), targetAsset: form.get("targetAsset"), targetDate: form.get("targetDate") || undefined }) });
    if (!response.ok) { const result = await response.json().catch(() => ({})) as { message?: string }; setError(result.message ?? "Goal could not be created."); return; }
    setOpen(false); event.currentTarget.reset(); await client.invalidateQueries({ queryKey: ["goals"] });
  }

  return <>
    <section className="panel goalsPanel">
      <div className="panelHeading"><div><h2>Goals</h2></div><button className="button primary small" onClick={() => setOpen(true)}><Plus size={15} /> New Goal</button></div>
      {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={17} /> Loading goals</div> : query.isError ? <div className="formError">{query.error.message}</div> : query.data.goals.length ? <div className="goalGrid">{query.data.goals.map((goal) => <article className="goalCard" key={goal.goalId}><span className="goalIcon"><Target size={18} /></span><div><strong>{goal.name}</strong><small>{goal.targetDate ? <><CalendarDays size={13} /> {new Date(`${goal.targetDate}T12:00:00Z`).toLocaleDateString()}</> : "No target date"}</small></div><b>{Number(goal.targetAmount).toLocaleString(undefined, { maximumFractionDigits: 2 })} {goal.targetAsset}</b><p>Target only · no balance linked</p><button className="button secondary small" onClick={() => update.mutate({ goalId: goal.goalId, action: goal.status === "active" ? "pause" : "resume" })} disabled={update.isPending}><CirclePause size={14} /> {goal.status === "active" ? "Pause" : "Resume"}</button></article>)}</div> : <div className="emptyState goalsEmpty"><Target size={24} /><strong>Set a goal without moving money</strong><span>Link a provider or onchain account later to show verified progress.</span><button className="button primary small" onClick={() => setOpen(true)}>Create Goal</button></div>}
      <p className="authorityFootnote">Goals are planning targets. Aurel does not reserve funds or create a balance.</p>
    </section>
    {open && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOpen(false)}><section className="financialModal" role="dialog" aria-modal="true" aria-labelledby="goal-title"><button className="modalClose" onClick={() => setOpen(false)} aria-label="Close"><X size={18} /></button><h2 id="goal-title">New Goal</h2><p>Set a target now. No money moves.</p><form onSubmit={create}><label className="fieldLabel">Name<input name="name" required maxLength={60} placeholder="Home deposit" /></label><div className="formSplit"><label className="fieldLabel">Target<input name="targetAmount" required inputMode="decimal" placeholder="25000" pattern="\d+(\.\d{1,2})?" /></label><label className="fieldLabel">Asset<select name="targetAsset" defaultValue="USD"><option>USD</option><option>USDC</option></select></label></div><label className="fieldLabel">Target Date <span className="optionalLabel">Optional</span><input name="targetDate" type="date" min={minimumGoalDate} /></label>{error && <div className="formError">{error}</div>}<button className="button primary full" type="submit">Create Goal</button></form></section></div>}
  </>;
}
