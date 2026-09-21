import { LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import dynamic from "next/dynamic";

const WalletWorkspace = dynamic(() => import("./wallet-workspace").then((module) => module.WalletWorkspace));
const EarnWorkspace = dynamic(() => import("./earn-workspace").then((module) => module.EarnWorkspace));
const SecurityCenter = dynamic(() => import("./security-center").then((module) => module.SecurityCenter));
const BorrowWorkspace = dynamic(() => import("./borrow-workspace").then((module) => module.BorrowWorkspace));
const MembershipBenefits = dynamic(() => import("./membership-benefits").then((module) => module.MembershipBenefits));
const ConciergeWorkspace = dynamic(() => import("./concierge-workspace").then((module) => module.ConciergeWorkspace));
const ActivityWorkspace = dynamic(() => import("./activity-workspace").then((module) => module.ActivityWorkspace));
const CrossChainWorkspace = dynamic(() => import("./cross-chain-workspace").then((module) => module.CrossChainWorkspace));
const MarketsWorkspace = dynamic(() => import("./markets-workspace").then((module) => module.MarketsWorkspace));
const OperationsWorkspace = dynamic(() => import("./operations-workspace").then((module) => module.OperationsWorkspace));
const NetworkSupportMatrix = dynamic(() => import("./network-support-matrix").then((module) => module.NetworkSupportMatrix));
const SettingsWorkspace = dynamic(() => import("./settings-workspace").then((module) => module.SettingsWorkspace));

type Section = "assets" | "earn" | "borrow" | "markets" | "card" | "activity" | "benefits" | "concierge" | "security" | "settings" | "operations";

const content: Record<Section, { eyebrow: string; title: string; description: string }> = {
  assets: { eyebrow: "Portfolio", title: "Assets", description: "Receive, send, and understand what you own." },
  earn: { eyebrow: "Invest", title: "Earn", description: "Compare liquidity and risk before you allocate." },
  borrow: { eyebrow: "Invest", title: "Borrow", description: "See cost, health, and liquidation risk before you sign." },
  markets: { eyebrow: "Invest", title: "Markets", description: "Tokenized markets will appear here after legal, provider, and country review." },
  card: { eyebrow: "Services", title: "Aurel Card", description: "Spend from a defined liquid reserve." },
  activity: { eyebrow: "Portfolio", title: "Activity", description: "Movements, approvals, fees, and status in one timeline." },
  benefits: { eyebrow: "Services", title: "Benefits", description: "See what your membership could include as Aurel grows." },
  concierge: { eyebrow: "Services", title: "Concierge", description: "Answers about Aurel, protocols, and account controls." },
  security: { eyebrow: "Account", title: "Security", description: "Control account access and how value can leave it." },
  settings: { eyebrow: "Account", title: "Settings", description: "Profile, notifications, disclosures, and providers." },
  operations: { eyebrow: "Internal", title: "Operations", description: "Reconciliation, event health, and exception triage." }
};

function Header({ section }: { section: Section }) {
  const item = content[section];
  return <section className="pageIntro compact"><div><p className="eyebrow">{item.eyebrow}</p><h1>{item.title}</h1><p>{item.description}</p></div></section>;
}

function Assets() {
  return <><WalletWorkspace /><CrossChainWorkspace /><NetworkSupportMatrix /></>;
}

function Earn() {
  return <EarnWorkspace />;
}

function Card() {
  return <div className="cardPageGrid"><section className="demoCardLarge unavailableCard"><div className="cardShine" /><div className="membershipTop"><span>AUREL</span><span>RESERVED</span></div><div className="cardChip" /><strong className="cardNumber">CARD NOT AVAILABLE</strong><div className="membershipBottom"><span><small>ISSUING PARTNER</small>NOT YET SELECTED</span><b>—</b></div></section><section className="panel cardControls"><p className="eyebrow">Planned service</p><h2>The Aurel Card is not live</h2><p>A card needs an approved issuer, identity checks, safeguarding, and transaction controls. Aurel will not show a simulated card as a working one.</p><div className="cardControlRow"><span><LockKeyhole size={18} /></span><div><strong>Card status</strong><small>No production issuer</small></div><span className="statusBadge neutral">Unavailable</span></div><div className="cardControlRow"><span><ShieldCheck size={18} /></span><div><strong>Planned controls</strong><small>Freeze, merchant, region, and spending limits</small></div><span className="statusBadge neutral">Designed</span></div><div className="cardControlRow"><span><Smartphone size={18} /></span><div><strong>Digital wallet</strong><small>Requires issuer and wallet approval</small></div><span className="statusBadge neutral">Future</span></div></section></div>;
}

function Benefits() {
  return <MembershipBenefits />;
}

function Security() {
  return <SecurityCenter />;
}

export function SectionPage({ section }: { section: Section }) {
  return <div><Header section={section} />{section === "assets" && <Assets />}{section === "earn" && <Earn />}{section === "borrow" && <BorrowWorkspace />}{section === "markets" && <MarketsWorkspace />}{section === "card" && <Card />}{section === "activity" && <ActivityWorkspace />}{section === "benefits" && <Benefits />}{section === "concierge" && <ConciergeWorkspace />}{section === "security" && <Security />}{section === "settings" && <SettingsWorkspace />}{section === "operations" && <OperationsWorkspace />}</div>;
}
