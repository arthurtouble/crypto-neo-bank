"use client";

import { usePrivy } from "@privy-io/react-auth";
import { useQuery } from "@tanstack/react-query";
import { CreditCard, Gauge, Globe2, KeyRound, LoaderCircle, LockKeyhole, Smartphone, Trash2 } from "lucide-react";

type CardResponse = {
  state: string;
  card: null | { status: string; lastFour?: string | null; network?: string | null; dailyLimit?: string | null; monthlyLimit?: string | null; currency: string };
  controls: Record<string, "available" | "locked" | "setup_required">;
  nextAction?: { label: string };
};

const rows = [
  { key: "freeze", label: "Freeze Card", icon: LockKeyhole },
  { key: "spending_limits", label: "Spending Limits", icon: Gauge },
  { key: "allowed_countries", label: "Allowed Countries", icon: Globe2 },
  { key: "pin", label: "PIN", icon: KeyRound },
  { key: "digital_wallet", label: "Wallet Provisioning", icon: Smartphone },
  { key: "terminate", label: "Terminate Card", icon: Trash2 }
] as const;

export function CardWorkspace() {
  const { user, getAccessToken } = usePrivy();
  const query = useQuery<CardResponse>({
    queryKey: ["card", user?.id],
    queryFn: async () => {
      const token = await getAccessToken();
      const response = await fetch("/api/cards", { headers: token ? { Authorization: `Bearer ${token}` } : undefined, cache: "no-store" });
      if (!response.ok) throw new Error("Card details could not be loaded.");
      return response.json();
    }, enabled: Boolean(user)
  });
  if (query.isPending) return <section className="panel cardWorkspaceLoading"><LoaderCircle className="spin" size={18} /> Loading card</section>;
  if (query.isError) return <section className="panel cardWorkspaceLoading formError">{query.error.message}</section>;
  const data = query.data;
  const active = Boolean(data.card && (data.state === "active" || data.state === "frozen"));
  return <div className="cardWorkspace">
    <section className={`aurelCard ${active ? "issued" : "unissued"}`} aria-label={active ? `Aura card ending ${data.card?.lastFour}` : "Aura card preview"}><div className="cardShine" /><div className="membershipTop"><span>AURA</span><span>{active ? data.card?.network?.toUpperCase() : "CARD"}</span></div><CreditCard className="cardPreviewIcon" size={30} /><strong className="cardNumber">{active && data.card?.lastFour ? `••••  ${data.card.lastFour}` : "ISSUER REQUIRED"}</strong><div className="membershipBottom"><span>{active ? data.state.toUpperCase() : "NOT ISSUED"}</span><b>{data.card?.network?.toUpperCase() ?? ""}</b></div></section>
    <section className="panel cardOverview"><div className="panelHeading"><div><h2>{active ? "Your Card" : "Add a card"}</h2></div><span className={`statusBadge ${active ? "good" : "neutral"}`}>{active ? data.state : "Not issued"}</span></div>{active ? <div className="cardLimitGrid"><span>Daily Limit<strong>{data.card?.dailyLimit ?? "Set in provider"} {data.card?.currency}</strong></span><span>Monthly Limit<strong>{data.card?.monthlyLimit ?? "Set in provider"} {data.card?.currency}</strong></span></div> : <div className="cardSetup"><CreditCard size={22} /><div><strong>Issuer connection required</strong><small>Card setup depends on Bridge or Rain program approval and your eligibility.</small></div><button className="button primary small" disabled>{data.nextAction?.label ?? "Add card"}</button></div>}</section>
    <section className="panel cardControlPanel"><div className="panelHeading"><div><h2>Card Controls</h2></div></div><div className="cardControlList">{rows.map(({ key, label, icon: Icon }) => { const state = data.controls[key] ?? "setup_required"; return <button key={key} disabled={state !== "available"}><span><Icon size={18} /></span><strong>{label}</strong><em>{state === "available" ? "Open" : state === "locked" ? "Locked" : "After Setup"}</em></button>; })}</div></section>
    <p className="authorityFootnote cardAuthority">Card status and controls come from the issuer. Aura does not create card details locally.</p>
  </div>;
}
