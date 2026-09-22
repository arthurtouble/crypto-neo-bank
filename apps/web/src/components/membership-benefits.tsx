"use client";

import { useWallets } from "@privy-io/react-auth";
import { Check, Gift, Plane, ShieldCheck, Smartphone, Sparkles, X } from "lucide-react";
import { useMemo, useState } from "react";
import { formatUnits, erc20Abi } from "viem";
import { useReadContract } from "wagmi";
import { BASE_ASSETS, HOME_CHAIN } from "@/config/chains";
import { qualifyMembership } from "@/lib/membership/qualification";
import { benefitServices, type BenefitService } from "@/lib/providers/service-catalog";
import { ReferralPanel } from "./referral-panel";

const icons = { rewards: Gift, lounges: Plane, esim: Smartphone, travel_protection: ShieldCheck, concierge: Sparkles };

export function MembershipBenefits() {
  const { wallets } = useWallets();
  const wallet = useMemo(() => wallets.find((item) => item.walletClientType === "privy") ?? wallets[0], [wallets]);
  const address = wallet?.address as `0x${string}` | undefined;
  const usdc = useReadContract({ address: BASE_ASSETS.USDC.address, abi: erc20Abi, functionName: "balanceOf", args: address ? [address] : undefined, chainId: HOME_CHAIN.id, query: { enabled: Boolean(address) } });
  const projection = qualifyMembership({ thirtyDayAverageUsd: usdc.data ? Number(formatUnits(usdc.data, 6)) : 0, monthlyActivityUsd: 0 });
  const [selected, setSelected] = useState<BenefitService | null>(null);

  return <>
    <section className="membershipSummary panel"><div><span className="membershipKicker">Your Membership</span><h2>{projection.tier}</h2></div><div className="membershipScore"><strong>{projection.score}</strong><span>/100</span><small>Progress</small></div>{projection.nextTier && <div className="nextTier"><span>Next Level</span><strong>{projection.nextTier.tier}</strong><small>${projection.nextTier.balanceGapUsd.toLocaleString()} average balance to go</small></div>}</section>
    <div className="benefitGrid">{benefitServices.map((benefit) => { const Icon = icons[benefit.key]; return <article className="panel benefitCard" key={benefit.key}><span className="benefitIcon"><Icon size={21} /></span><span className="statusBadge neutral">{benefit.state === "available" ? "Included" : "Set Up"}</span><h3>{benefit.name}</h3><p>{benefit.summary}</p><button onClick={() => setSelected(benefit)}>{benefit.action}</button></article>; })}</div>
    <ReferralPanel />
    {selected && <div className="modalBackdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setSelected(null)}><section className="financialModal benefitModal" role="dialog" aria-modal="true" aria-labelledby="benefit-title"><button className="modalClose" onClick={() => setSelected(null)} aria-label="Close"><X size={18} /></button><span className="benefitIcon">{(() => { const Icon = icons[selected.key]; return <Icon size={21} />; })()}</span><h2 id="benefit-title">{selected.name}</h2><p>{selected.summary}</p><div className="setupPrompt compact"><span><Check size={20} /></span><h3>Available With Membership</h3><p>Complete account setup to check eligibility and activate this benefit.</p><button className="button primary full">Continue Setup</button></div></section></div>}
  </>;
}
