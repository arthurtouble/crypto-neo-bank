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
    <section className="pageIntro"><div><h1>Good to see you, {greeting}.</h1></div><DashboardActions /></section>
    <ActivationJourney usdcBalance={usdc.data} />
    <section className="balanceHero panel"><div className="balanceLead"><div className="balanceLabel"><span>Available Balance</span><span className="statusBadge good"><i /> Current</span></div><div className="heroAmount sensitiveAmount">{amount(usdc.data, 6, 2)} <small>USDC</small></div><div className="heroDelta">Aurel Account · {address ? short(address) : "Loading"}</div></div><div className="metricsGrid"><div className="metric"><span>Ether</span><strong className="sensitiveAmount">{eth.data ? Number(formatEther(eth.data.value)).toLocaleString(undefined, { maximumFractionDigits: 5 }) : "—"} ETH</strong></div><div className="metric"><span>Wrapped Ether</span><strong className="sensitiveAmount">{amount(weth.data, 18)} WETH</strong></div><div className="metric"><span>Membership</span><strong>{membership.tier}</strong></div></div></section>
    <section className="dashboardGrid">
      <article className="panel allocationPanel"><div className="panelHeading"><div><h2>Your Accounts</h2></div><ShieldCheck size={19} /></div><div className="riskList"><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Aurel Account</span><small>Ready</small></div><strong>You Control</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Bank Transfers</span><small>Account setup required</small></div><strong>Set Up</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Investments</span><small>Selected markets</small></div><strong>Explore</strong></div></div><Link className="textLink" href="/app/assets">View Assets <ArrowRight size={15} /></Link></article>
      <article className="panel riskPanel"><div className="panelHeading"><div><h2>Security</h2></div><span className="statusBadge good"><i /> Protected</span></div><div className="riskList"><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Transfer Approval</span></div><strong>You Confirm</strong></div><div className="riskItem good"><span className="riskIcon"><CheckCircle2 size={18} /></span><div><span>Transaction Controls</span></div><strong>Active</strong></div></div><Link className="textLink" href="/app/security">Review Security <ArrowRight size={15} /></Link></article>
      <article className="panel activityPanel"><div className="panelHeading"><div><p className="eyebrow">Activity</p><h2>Recent actions</h2></div><Link href="/app/activity">View all</Link></div><div className="activityList">{activity.isPending ? <div className="emptyState"><Clock3 size={18} /> Checking activity…</div> : activity.data?.intents.length ? activity.data.intents.slice(0, 4).map((item) => <div className="activityRow" key={item.intentId}><span className="activityIcon neutral">↗</span><div><strong>{item.type.replaceAll("_", " ")}</strong><small>{new Date(item.createdAt).toLocaleString()} · {item.status}</small></div><div className="activityAmount"><strong>{item.amount ? `${item.amount} ${item.asset ?? ""}` : "—"}</strong>{item.transactionHash ? <a href={`https://basescan.org/tx/${item.transactionHash}`} target="_blank" rel="noreferrer">BaseScan <ExternalLink size={11} /></a> : <small>Not submitted</small>}</div></div>) : <div className="emptyState">No transactions yet.</div>}</div></article>
      <aside className="rightRail"><article className="membershipCard"><div className="membershipTop"><span>AUREL</span><span>{membership.tier.toUpperCase()}</span></div><div><small>PROJECTED MEMBERSHIP</small><strong>{address ? short(address) : "WALLET LOADING"}</strong></div><div className="membershipBottom"><span>NO TOKEN</span><span>INDEPENDENT</span></div></article><article className="panel progressPanel"><div className="panelHeading"><div><p className="eyebrow">Membership</p><h3>{membership.tier} projection</h3></div><span>{membership.score}/100</span></div><div className="progressTrack"><i style={{ width: `${membership.score}%` }} /></div><p>This estimate uses today’s eligible assets. An earned tier will use a 30-day average.</p><Link href="/app/benefits">See benefits <ArrowRight size={15} /></Link></article><article className="conciergeCard"><span>CONCIERGE</span><h3>Get a clear answer.</h3><p>Ask how a feature, protocol, or safety setting works. Concierge cannot move money.</p><Link href="/app/concierge">Ask concierge <ArrowRight size={15} /></Link></article></aside>
    </section>
  </div>;
}
