"use client";

import { useMfa, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ChartNoAxesCombined, CircleDollarSign, Gift, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { toHex } from "viem";
import { HOME_CHAIN } from "@/config/chains";
import type { AaveBaseRewards } from "@/lib/defi/aave";
import type { TransactionLifecycleStatus } from "@/lib/transactions/lifecycle";
import { TransactionProgress } from "./transaction-progress";

type Overview = { marketsWithPosition: number; supplyGroups: number; borrowGroups: number; healthFactor?: string; netWorthUsd?: string };
type PositionResponse = { overview: Overview; rewards: AaveBaseRewards; observedAt: string; authority: string };
type ClaimPlan = { rewards: AaveBaseRewards; transaction: { to: `0x${string}`; from: `0x${string}`; data: `0x${string}`; value: string; chainId: 8453 }; message?: string };

const money = new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const amount = new Intl.NumberFormat(undefined, { maximumFractionDigits: 6 });

export function DefiPositions({ address }: { address: string }) {
  const { wallets } = useWallets();
  const { getAccessToken } = usePrivy();
  const { mfaMethods } = useMfa();
  const { sendTransaction } = useSendTransaction();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets.find((item) => item.address.toLowerCase() === address.toLowerCase()) ?? wallets[0], [address, wallets]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hash, setHash] = useState<string | null>(null);
  const [intentId, setIntentId] = useState<string | null>(null);
  const [flowStatus, setFlowStatus] = useState<TransactionLifecycleStatus | null>(null);
  const query = useQuery<PositionResponse>({
    queryKey: ["defi-positions", address],
    queryFn: async () => {
      const response = await fetch(`/api/defi/aave/positions?address=${address}`, { cache: "no-store" });
      if (!response.ok) throw new Error("DeFi positions could not be loaded.");
      return response.json();
    }, refetchInterval: 30_000
  });
  const overview = query.data?.overview;
  const rewards = query.data?.rewards;

  async function claimRewards() {
    if (!wallet || !rewards?.claimAvailable) return;
    setWorking(true); setError(null); setHash(null); setIntentId(null); setFlowStatus("reviewing");
    let token: string | null = null;
    let reviewedIntent: string | undefined;
    try {
      token = await getAccessToken();
      if (!token) throw new Error("Your secure session expired.");
      const planResponse = await fetch("/api/defi/aave/rewards", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ sender: wallet.address }) });
      const plan = await planResponse.json() as ClaimPlan;
      if (!planResponse.ok || !plan.transaction) throw new Error(plan.message ?? "Aave could not prepare this claim.");
      const intentResponse = await fetch("/api/intents/evaluate", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ type: "earn_claim", walletAddress: wallet.address, chainId: HOME_CHAIN.id, asset: "Aave rewards", amount: plan.rewards.totalUsd, destination: plan.transaction.to, estimatedUsd: Number(plan.rewards.totalUsd) || undefined }) });
      const intent = await intentResponse.json() as { intentId?: string; message?: string; decision?: { requiresStepUp?: boolean; findings?: Array<{ level: string; message: string }> } };
      if (!intentResponse.ok || !intent.intentId) throw new Error(intent.decision?.findings?.find((item) => item.level === "block")?.message ?? intent.message ?? "The claim did not pass safety review.");
      reviewedIntent = intent.intentId; setIntentId(intent.intentId);
      if (intent.decision?.requiresStepUp && !mfaMethods.includes("passkey")) throw new Error("Set up a passkey in Security before claiming these rewards.");
      const provider = await wallet.getEthereumProvider();
      const simulation = { from: wallet.address, to: plan.transaction.to, data: plan.transaction.data, value: toHex(BigInt(plan.transaction.value)) };
      await provider.request({ method: "eth_estimateGas", params: [simulation] });
      await provider.request({ method: "eth_call", params: [simulation, "latest"] });
      setFlowStatus("awaiting_confirmation");
      const submitted = await sendTransaction({ to: plan.transaction.to, data: plan.transaction.data, value: BigInt(plan.transaction.value), chainId: HOME_CHAIN.id }, { address: wallet.address, uiOptions: { description: `Claim ${plan.rewards.items.length} Aave reward${plan.rewards.items.length === 1 ? "" : "s"}.`, buttonText: "Confirm claim", isCancellable: true } });
      setHash(submitted.hash); setFlowStatus("submitted");
      await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId: intent.intentId, status: "submitted", transactionHash: submitted.hash }) });
    } catch (caught) {
      if (reviewedIntent && token) await fetch("/api/intents/status", { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ intentId: reviewedIntent, status: "cancelled" }) }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "The claim was not submitted."); setFlowStatus("failed");
    } finally { setWorking(false); }
  }

  return <section className="panel defiPositions">
    <div className="panelHeading"><div><h2>DeFi Positions</h2></div><span className="statusBadge neutral">Aave V3</span></div>
    {query.isPending ? <div className="compactState"><LoaderCircle className="spin" size={16} /> Reading positions</div> : query.isError ? <div className="formError">{query.error.message}</div> : overview && overview.marketsWithPosition > 0 ? <><div className="defiMetrics"><span><ChartNoAxesCombined size={17} /><small>Active Markets</small><strong>{overview.marketsWithPosition}</strong></span><span><ShieldCheck size={17} /><small>Health Factor</small><strong>{overview.healthFactor ?? "No active debt"}</strong></span><span><CircleDollarSign size={17} /><small>Net Position</small><strong>{overview.netWorthUsd ? money.format(Number(overview.netWorthUsd)) : "Unavailable"}</strong></span></div><div className="defiPositionFooter"><span>{overview.supplyGroups} supplied · {overview.borrowGroups} borrowed</span><Link href="/app/activity">View Activity</Link></div></> : <div className="emptyState compact"><ChartNoAxesCombined size={22} /><strong>No Aave positions found</strong><span>Positions appear here directly from Aave after settlement.</span><div className="emptyActions"><Link className="button secondary small" href="/app/earn">Explore Earn</Link><Link className="button secondary small" href="/app/borrow">Borrow</Link></div></div>}
    {rewards && rewards.items.length > 0 && <section className="defiRewards"><div className="defiRewardsHeading"><span><Gift size={17} /><strong>Claimable Rewards</strong></span><strong>{money.format(Number(rewards.totalUsd))}</strong></div><div className="defiRewardRows">{rewards.items.map((item) => <div key={`${item.tokenAddress}-${item.symbol}`}><span><strong>{item.name}</strong><small>{item.symbol}</small></span><span><strong>{amount.format(Number(item.amount))}</strong><small>{money.format(Number(item.usd))}</small></span></div>)}</div><button className="button secondary full" disabled={working || Boolean(hash)} onClick={() => void claimRewards()}>{working ? <LoaderCircle className="spin" size={15} /> : <Gift size={15} />}{hash ? "Claim Submitted" : working ? "Preparing Claim" : "Claim Rewards"}</button></section>}
    {flowStatus && <TransactionProgress action="Reward claim" status={flowStatus} error={error} intentId={intentId} hashes={hash ? [hash] : []} chainId={HOME_CHAIN.id} onConfirmed={() => void query.refetch()} />}
    {query.data && <p className="authorityFootnote">Observed {new Date(query.data.observedAt).toLocaleTimeString()} · Aave and public-chain data remain authoritative.</p>}
  </section>;
}
