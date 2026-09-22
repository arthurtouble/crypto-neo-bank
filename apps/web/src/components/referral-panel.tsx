"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { Check, Copy, LoaderCircle, UserPlus } from "lucide-react";
import { useState } from "react";

type Eligibility = { eligible: boolean; reasons: string[] };

const reasonLabels: Record<string, string> = {
  feature_paused: "Invitations are not open for this cohort.",
  access_inactive: "Private access must be active.",
  account_not_secured: "Complete your account controls.",
  first_value_incomplete: "Complete your first confirmed action.",
  retention_incomplete: "Use Aurel through the first 30-day checkpoint.",
  critical_issue_open: "Resolve the open account issue.",
  country_unavailable: "Invitations are not available in your country.",
  invite_limit_reached: "Your current invitation is still active."
};

export function ReferralPanel() {
  const { getAccessToken, authenticated } = usePrivy();
  const [link, setLink] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const eligibility = useQuery<Eligibility>({
    queryKey: ["referral-eligibility"],
    enabled: authenticated,
    retry: false,
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/growth/referrals", { headers: token ? { Authorization: `Bearer ${token}` } : {}, cache: "no-store" });
      if (!response.ok) throw new Error("Invitation status is unavailable.");
      return response.json();
    }
  });

  async function create() {
    setWorking(true);
    try {
      const token = await getAccessToken();
      const response = await fetch("/api/growth/referrals", { method: "POST", headers: token ? { Authorization: `Bearer ${token}` } : {} });
      const body = await response.json() as { referralUrl?: string };
      if (!response.ok || !body.referralUrl) throw new Error("The invitation could not be created.");
      setLink(body.referralUrl);
      await eligibility.refetch();
    } finally { setWorking(false); }
  }

  return <section className="panel referralPanel">
    <span className="benefitIcon"><UserPlus size={20} /></span>
    <div><h2>Private Invitation</h2><p>Invite one person when your account reaches the eligibility checkpoint.</p></div>
    {eligibility.isPending ? <LoaderCircle className="spin" size={18} /> : eligibility.data?.eligible ? <button className="button secondary" disabled={working} onClick={() => void create()}>{working ? "Creating" : "Create Invitation"}</button> : <span className="statusBadge neutral">Locked</span>}
    {!eligibility.data?.eligible && eligibility.data?.reasons?.[0] && <small>{reasonLabels[eligibility.data.reasons[0]] ?? "Complete the required account checkpoint."}</small>}
    {link && <div className="referralLink"><Check size={15} /><input readOnly value={link} aria-label="Private invitation link" /><button onClick={() => void navigator.clipboard.writeText(link)} aria-label="Copy private invitation"><Copy size={15} /></button></div>}
  </section>;
}
