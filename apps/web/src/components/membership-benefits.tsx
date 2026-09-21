"use client";

import { useWallets } from "@privy-io/react-auth";
import { Gift, Plane, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { useMemo } from "react";
import { formatUnits } from "viem";
import { useReadContract } from "wagmi";
import { erc20Abi } from "viem";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";
import { qualifyMembership } from "@/lib/membership/qualification";

const icons = { "priority-support": Gift, lounge: Plane, esim: Smartphone, "travel-protection": ShieldCheck, concierge: Sparkles };

export function MembershipBenefits() {
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const address = wallet?.address as `0x${string}` | undefined;
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const currentUsdc = usdc.data ? Number(formatUnits(usdc.data, 6)) : 0;
  const projection = qualifyMembership({ thirtyDayAverageUsd: currentUsdc, monthlyActivityUsd: 0 });

  return <><section className="membershipSummary panel"><div><p className="eyebrow">Membership estimate</p><h2>{projection.tier}</h2><p>This is the tier you could reach if today’s eligible Base USDC balance stays in place for 30 days. It is not earned yet.</p></div><div className="membershipScore"><strong>{projection.score}</strong><span>/100</span><small>membership score</small></div>{projection.nextTier && <div className="nextTier"><span>Next tier</span><strong>{projection.nextTier.tier}</strong><small>Maintain another ${projection.nextTier.balanceGapUsd.toLocaleString()} on average, or qualify through eligible activity.</small></div>}</section>
    <div className="benefitGrid">{projection.entitlements.map((benefit) => { const Icon = icons[benefit.key as keyof typeof icons] ?? Gift; return <article className="panel benefitCard" key={benefit.key}><span className="benefitIcon"><Icon size={21} /></span><span className="statusBadge neutral">{benefit.status.replaceAll("_", " ")}</span><h3>{benefit.name}</h3><p>{benefit.allowance === null ? "Depends on your membership and the provider launch." : benefit.allowance > 0 ? `${benefit.allowance} per membership period after launch.` : "Available at a higher tier."}</p><button disabled>Not live yet</button></article>; })}</div>
    <p className="authorityFootnote">Aurel estimates tiers from balance history reported by the chain and connected providers. Benefits stay inactive until their providers are contracted.</p></>;
}
