"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";

type RewardsResponse = {
  state: "observed" | "not_connected";
  membership: null | { tier: string; renewalAt: string; observedAt: string };
  entitlements: Array<{ entitlementId: string; benefitKey: string; status: string; allowance: number | null; consumed: number; periodEnd: string; provider: string }>;
};

const label = (key: string) => key.replace(/[._]/g, " ").replace(/^\w/, (first) => first.toUpperCase());
const date = (value: string) => new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

export function RewardsWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const query = useQuery<RewardsResponse>({
    queryKey: ["rewards", user?.id], enabled: Boolean(user),
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/rewards", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Rewards could not be loaded.");
      return response.json();
    }
  });
  const data = query.data;
  if (data?.state === "observed") {
    return <div className="exampleGrid">
      {data.membership ? <section className="panel exampleCard"><span className="exampleLabel">Membership</span><strong>{label(data.membership.tier)}</strong>
        <p>Renews {date(data.membership.renewalAt)}. Updated {date(data.membership.observedAt)}.</p></section> : null}
      {data.entitlements.map((benefit) => <section className="panel exampleCard" key={benefit.entitlementId}>
        <span className="exampleLabel">Benefit</span><strong>{label(benefit.benefitKey)}</strong>
        <p>{benefit.allowance === null ? `${benefit.consumed} used` : `${benefit.consumed} of ${benefit.allowance} used`} until {date(benefit.periodEnd)}.
          {benefit.status === "active" ? "" : ` Status: ${benefit.status}.`} Provided by {benefit.provider}.</p></section>)}
      <section className="panel exampleCard"><span className="exampleLabel">Help</span><strong>Questions?</strong><p>Benefit terms come from the provider that issues them.</p><Link className="textLink" href="/app/support">Visit support</Link></section>
    </div>;
  }
  return <div className="exampleGrid">
    <section className="panel exampleCard"><span className="exampleLabel">Cashback</span><strong>Unavailable</strong><p>Cashback appears only after a funded provider program and eligible card spending are connected.</p></section>
    <section className="panel exampleCard"><span className="exampleLabel">Benefits</span><strong>Unavailable</strong><p>Benefits appear here once a provider issues an entitlement to your account.</p></section>
    <section className="panel exampleCard"><span className="exampleLabel">Help</span><strong>Questions?</strong><p>See current product availability and partner responsibilities.</p><Link className="textLink" href="/app/support">Visit support</Link></section>
  </div>;
}
