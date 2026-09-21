"use client";

import { useMfa, usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Circle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { formatUnits } from "viem";

type Progress = { progress: { networkGuideRead: boolean; riskGuideRead: boolean; hasSubmittedTransaction: boolean; hasEarnPosition: boolean } };

export function ActivationJourney({ usdcBalance }: { usdcBalance?: bigint }) {
  const { user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const { mfaMethods } = useMfa();
  const queryClient = useQueryClient();
  const [saving, setSaving] = useState(false);
  const walletReady = wallets.length > 0;
  const passkeyReady = mfaMethods.includes("passkey");
  const funded = Number(formatUnits(usdcBalance ?? 0n, 6)) > 0;
  const progress = useQuery<Progress>({
    queryKey: ["profile-progress", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/profile", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Activation progress is unavailable.");
      return response.json();
    },
    enabled: Boolean(user)
  });

  async function acknowledgeGuide() {
    setSaving(true);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/profile", { method: "PATCH", headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "Content-Type": "application/json" }, body: JSON.stringify({ networkGuideRead: true, riskGuideRead: true }) });
      if (!response.ok) throw new Error("Could not save your progress.");
      await queryClient.invalidateQueries({ queryKey: ["profile-progress", user?.id] });
    } finally { setSaving(false); }
  }

  const tasks = useMemo(() => [
    { label: "Secure account", detail: passkeyReady ? "Passkey enrolled" : "Add a passkey before higher-value actions", complete: passkeyReady, href: "/app/security" },
    { label: "Wallet ready", detail: walletReady ? "Customer-controlled wallet active" : "Wallet is being prepared", complete: walletReady, href: "/app/security" },
    { label: "Understand transfers", detail: "Review supported networks and recovery rules", complete: Boolean(progress.data?.progress.networkGuideRead && progress.data?.progress.riskGuideRead), href: "https://aurel-docs.aurel-events.workers.dev/product/networks-and-assets/" },
    { label: "Add money", detail: funded ? "USDC observed on Base" : "Begin with a small test transfer", complete: funded, href: "/app/assets" },
    { label: "Complete first action", detail: "Send, route, or allocate after reviewing the details", complete: Boolean(progress.data?.progress.hasSubmittedTransaction), href: "/app/activity" }
  ], [funded, passkeyReady, progress.data, walletReady]);
  const complete = tasks.filter((item) => item.complete).length;
  const nextTask = tasks.find((item) => !item.complete);

  if (complete === tasks.length) return null;
  return <section className="activationPanel panel">
    <div className="activationHeader"><div><p className="eyebrow">GET STARTED</p><h2>Prepare your account</h2><p>{complete} of {tasks.length} complete · start small and verify each step.</p></div><span>{Math.round((complete / tasks.length) * 100)}%</span></div>
    <div className="activationTrack"><i style={{ width: `${(complete / tasks.length) * 100}%` }} /></div>
    {progress.isError && <div className="formError" role="alert">Your saved setup progress could not be loaded. Wallet and balance checks still come from their source.</div>}
    <div className="activationTasks">{tasks.map((task) => <Link href={task.href} key={task.label} className={`${task.complete ? "complete" : ""} ${nextTask?.label === task.label ? "next" : ""}`}>{task.complete ? <Check size={15} /> : <Circle size={15} />}<span><strong>{task.label}</strong><small>{task.detail}</small></span>{nextTask?.label === task.label && <b>Next</b>}</Link>)}</div>
    {!progress.data?.progress.networkGuideRead && <button className="activationAcknowledge" disabled={saving} onClick={() => void acknowledgeGuide()}><ShieldCheck size={15} /> {saving ? "Saving…" : "I reviewed the network and risk guide"}</button>}
  </section>;
}
