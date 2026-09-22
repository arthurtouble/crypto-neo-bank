import { LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import dynamic from "next/dynamic";

const WalletWorkspace = dynamic(() => import("./wallet-workspace").then((module) => module.WalletWorkspace));
const MoneyWorkspace = dynamic(() => import("./money-workspace").then((module) => module.MoneyWorkspace));
const EarnWorkspace = dynamic(() => import("./earn-workspace").then((module) => module.EarnWorkspace));
const SecurityCenter = dynamic(() => import("./security-center").then((module) => module.SecurityCenter));
const BorrowWorkspace = dynamic(() => import("./borrow-workspace").then((module) => module.BorrowWorkspace));
const MembershipBenefits = dynamic(() => import("./membership-benefits").then((module) => module.MembershipBenefits));
const ConciergeWorkspace = dynamic(() => import("./concierge-workspace").then((module) => module.ConciergeWorkspace));
const ActivityWorkspace = dynamic(() => import("./activity-workspace").then((module) => module.ActivityWorkspace));
const CrossChainWorkspace = dynamic(() => import("./cross-chain-workspace").then((module) => module.CrossChainWorkspace));
const MarketsWorkspace = dynamic(() => import("./markets-workspace").then((module) => module.MarketsWorkspace));
const OperationsWorkspace = dynamic(() => import("./operations-workspace").then((module) => module.OperationsWorkspace));
const SettingsWorkspace = dynamic(() => import("./settings-workspace").then((module) => module.SettingsWorkspace));
const SystemStatus = dynamic(() => import("./system-status").then((module) => module.SystemStatus));

type Section = "transfers" | "assets" | "exchange" | "earn" | "borrow" | "markets" | "card" | "activity" | "benefits" | "concierge" | "security" | "settings" | "status" | "operations";

const content: Record<Section, { eyebrow: string; title: string; description: string }> = {
  transfers: { eyebrow: "", title: "Move Money", description: "" },
  assets: { eyebrow: "Portfolio", title: "Portfolio", description: "Receive, send, and understand what you own." },
  exchange: { eyebrow: "Invest", title: "Swap", description: "Swap assets without managing networks." },
  earn: { eyebrow: "Invest", title: "Earn", description: "Compare liquidity and risk before you allocate." },
  borrow: { eyebrow: "Invest", title: "Borrow", description: "See cost, health, and liquidation risk before you sign." },
  markets: { eyebrow: "Invest", title: "Markets", description: "Tokenized markets will appear here after legal, provider, and country review." },
  card: { eyebrow: "Services", title: "Aurel Card", description: "Spend from a defined liquid reserve." },
  activity: { eyebrow: "Portfolio", title: "Activity", description: "Movements, approvals, fees, and status in one timeline." },
  benefits: { eyebrow: "Services", title: "Benefits", description: "See what your membership could include as Aurel grows." },
  concierge: { eyebrow: "Services", title: "Concierge", description: "Answers about Aurel, protocols, and account controls." },
  security: { eyebrow: "Account", title: "Security", description: "Control account access and how value can leave it." },
  settings: { eyebrow: "Account", title: "Settings", description: "Profile, notifications, disclosures, and providers." },
  status: { eyebrow: "Aurel", title: "System status", description: "Current availability across Aurel and its core dependencies." },
  operations: { eyebrow: "Internal", title: "Operations", description: "Reconciliation, event health, and exception triage." }
};

function Header({ section }: { section: Section }) {
  const item = content[section];
  return <section className="pageIntro compact"><div><h1>{item.title}</h1></div></section>;
}

function Assets() {
  return <WalletWorkspace />;
}

function Earn() {
  return <EarnWorkspace />;
}

function Card() {
  return <div className="cardPageGrid"><section className="demoCardLarge"><div className="cardShine" /><div className="membershipTop"><span>AUREL</span><span>WORLD</span></div><div className="cardChip" /><strong className="cardNumber">•••• &nbsp; •••• &nbsp; •••• &nbsp; 1842</strong><div className="membershipBottom"><span><small>MEMBER</small>AUREL MEMBER</span><b>VISA</b></div></section><section className="panel cardControls"><h2>Aurel Card</h2><div className="cardControlRow"><span><LockKeyhole size={18} /></span><div><strong>Card Access</strong><small>Complete setup to request your card</small></div><button className="statusBadge neutral">Set Up</button></div><div className="cardControlRow"><span><ShieldCheck size={18} /></span><div><strong>Spending Controls</strong><small>Limits, merchants, and regions</small></div><span className="statusBadge neutral">Ready</span></div><div className="cardControlRow"><span><Smartphone size={18} /></span><div><strong>Digital Wallet</strong><small>Add after your card is issued</small></div><span className="statusBadge neutral">After Setup</span></div></section></div>;
}

function Benefits() {
  return <MembershipBenefits />;
}

function Security() {
  return <SecurityCenter />;
}

export function SectionPage({ section }: { section: Section }) {
  return <div><Header section={section} />{section === "transfers" && <MoneyWorkspace />}{section === "assets" && <Assets />}{section === "exchange" && <CrossChainWorkspace />}{section === "earn" && <Earn />}{section === "borrow" && <BorrowWorkspace />}{section === "markets" && <MarketsWorkspace />}{section === "card" && <Card />}{section === "activity" && <ActivityWorkspace />}{section === "benefits" && <Benefits />}{section === "concierge" && <ConciergeWorkspace />}{section === "security" && <Security />}{section === "settings" && <SettingsWorkspace />}{section === "status" && <SystemStatus />}{section === "operations" && <OperationsWorkspace />}</div>;
}
