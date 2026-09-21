"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { ArrowRight, CheckCircle2, Clock3, ExternalLink, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { useMemo } from "react";
import { erc20Abi, formatEther, formatUnits } from "viem";
import { useBalance, useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";
import { qualifyMembership } from "@/lib/membership/qualification";
import { DashboardActions } from "./dashboard-actions";
import { ActivationJourney } from "./activation-journey";

type Intent = { intentId: string; type: string; status: string; transactionHash?: string; createdAt: string; asset?: string; amount?: string };
type ActivityResponse = { intents: Intent[] };

function amount(value: bigint | undefined, decimals: number, maximumFractionDigits = 4) {
  if (value === undefined) return "—";
  return Number(formatUnits(value, decimals)).toLocaleString(undefined, { maximumFractionDigits });
}

function short(address: string) { return `${address.slice(0, 6)}…${address.slice(-4)}`; }

export function Dashboard() {
  const { user, getAccessToken } = usePrivy();
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const address = wallet?.address as `0x${string}` | undefined;
  const eth = useBalance({ address, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const weth = useReadContract({ address: BASE_ASSETS.WETH.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const usdcValue = usdc.data ? Number(formatUnits(usdc.data, 6)) : 0;
  const membership = qualifyMembership({ thirtyDayAverageUsd: usdcValue, monthlyActivityUsd: 0 });
  const activity = useQuery<ActivityResponse>({
    queryKey: ["activity", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/activity", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Activity unavailable");
      return response.json();
    },
    enabled: Boolean(user),
    refetchInterval: 30_000
  });
  const greeting = user?.email?.address?.split("@")[0] ?? "there";

  return <div className="dashboardPage">
    <section className="pageIntro"><div><p className="eyebrow">CUSTOMER-CONTROLLED · BASE MAINNET</p><h1>Good to see you, {greeting}.</h1><p>Your overview is rebuilt from your wallet and providers. Aurel is not the ledger of record.</p></div><DashboardActions /></section>
    <ActivationJourney usdcBalance={usdc.data} />
    <section className="balanceHero panel"><div className="balanceLead"><div className="balanceLabel"><span>Immediately liquid on Base</span><span className="statusBadge good"><i /> Live</span></div><div className="heroAmount sensitiveAmount">{amount(usdc.data, 6, 2)} <small>USDC</small></div><div className="heroDelta">Observed directly from {address ? short(address) : "your embedded wallet"}</div></div><div className="metricsGrid"><div className="metric"><span>Native gas</span><strong className="sensitiveAmount">{eth.data ? Number(formatEther(eth.data.value)).toLocaleString(undefined, { maximumFractionDigits: 5 }) : "—"} ETH</strong><small>Base mainnet</small></div><div className="metric"><span>Wrapped Ether</span><strong className="sensitiveAmount">{amount(weth.data, 18)} WETH</strong><small>Base mainnet</small></div><div className="metric"><span>Relationship projection</span><strong>{membership.tier}</strong><small>Based on current eligible USDC</small></div></div></section>
    <section className="dashboardGrid">
      <article className="panel allocationPanel"><div className="panelHeading"><div><p className="eyebrow">AUTHORITATIVE SOURCES</p><h2>Your financial control plane</h2></div><ShieldCheck size={19} /></div><div className="riskList"><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Wallet custody</span><small>Customer-controlled Privy wallet</small></div><strong>Self-custodied</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Balances</span><small>Read from Base contracts</small></div><strong>Onchain</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>DeFi positions</span><small>Aave V3 protocol data</small></div><strong>Provider observed</strong></div></div><Link className="textLink" href="/app/assets">Inspect assets and provenance <ArrowRight size={15} /></Link></article>
      <article className="panel riskPanel"><div className="panelHeading"><div><p className="eyebrow">SAFETY</p><h2>Control posture</h2></div><span className="statusBadge good"><i /> User-signed</span></div><div className="riskList"><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Transaction authority</span><small>Aurel cannot sign or move funds</small></div><strong>Customer</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Network</span><small>All action plans are chain-bound</small></div><strong>Base</strong></div></div><Link className="textLink" href="/app/security">Review safety controls <ArrowRight size={15} /></Link></article>
      <article className="panel activityPanel"><div className="panelHeading"><div><p className="eyebrow">ACTIVITY</p><h2>Recent intentions</h2></div><Link href="/app/activity">View all</Link></div><div className="activityList">{activity.isPending ? <div className="emptyState"><Clock3 size={18} /> Reading your activity…</div> : activity.data?.intents.length ? activity.data.intents.slice(0, 4).map((item) => <div className="activityRow" key={item.intentId}><span className="activityIcon neutral">↗</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.status}</small></div><div className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "—"}</strong>{item.transactionHash ? <a href={`https://basescan.org/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={11} /></a> : <small>No transaction hash</small>}</div></div>) : <div className="emptyState">No reviewed transactions yet.</div>}</div></article>
      <aside className="rightRail"><article className="membershipCard"><div className="membershipTop"><span>AUREL</span><span>{membership.tier.toUpperCase()}</span></div><div><small>PROJECTED RELATIONSHIP</small><strong>{address ? short(address) : "WALLET PREPARING"}</strong></div><div className="membershipBottom"><span>NO TOKEN</span><span>ALIGNED</span></div></article><article className="panel progressPanel"><div className="panelHeading"><div><p className="eyebrow">MEMBERSHIP</p><h3>{membership.tier} projection</h3></div><span>{membership.score}/100</span></div><div className="progressTrack"><i style={{ width: `${membership.score}%` }} /></div><p>Projected from current eligible assets. Qualification uses a 30-day average once the observation history is complete.</p><Link href="/app/benefits">Explore benefits <ArrowRight size={15} /></Link></article><article className="conciergeCard"><span>PRIVATE CONCIERGE</span><h3>Understand before you act.</h3><p>Ask about product mechanics, protocol risk, or account controls. The concierge cannot transact.</p><Link href="/app/concierge">Start a conversation <ArrowRight size={15} /></Link></article></aside>
    </section>
  </div>;
}
