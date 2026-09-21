import { LockKeyhole, ShieldCheck, Smartphone } from "lucide-react";
import { WalletWorkspace } from "@/components/wallet-workspace";
import { EarnWorkspace } from "@/components/earn-workspace";
import { SecurityCenter } from "@/components/security-center";
import { BorrowWorkspace } from "@/components/borrow-workspace";
import { MembershipBenefits } from "@/components/membership-benefits";
import { ConciergeWorkspace } from "@/components/concierge-workspace";
import { ActivityWorkspace } from "@/components/activity-workspace";
import { CrossChainWorkspace } from "@/components/cross-chain-workspace";

type Section = "assets" | "earn" | "borrow" | "card" | "activity" | "benefits" | "concierge" | "security" | "settings";

const content: Record<Section, { eyebrow: string; title: string; description: string }> = {
  assets: { eyebrow: "YOUR BALANCE SHEET", title: "Assets", description: "One coherent view across Aurel and the wallets you control elsewhere." },
  earn: { eyebrow: "PRODUCTIVE CAPITAL", title: "Earn", description: "Curated, transparent strategies with liquidity and risk explained before you allocate." },
  borrow: { eyebrow: "COLLATERALIZED LIQUIDITY", title: "Borrow", description: "Protocol-native credit with health factors, liquidation boundaries, and simulation before every signature." },
  card: { eyebrow: "GLOBAL SPEND", title: "Aurel Card", description: "A future card program designed around your liquid stablecoin reserve." },
  activity: { eyebrow: "AUDITABLE HISTORY", title: "Activity", description: "Every movement, authorization, fee, and status in one timeline." },
  benefits: { eyebrow: "RELATIONSHIP BENEFITS", title: "Black membership", description: "Practical benefits that become more valuable as your relationship deepens." },
  concierge: { eyebrow: "PRIVATE CLIENT SERVICE", title: "Concierge", description: "Clear answers grounded in product documentation, with no authority to move your assets." },
  security: { eyebrow: "DEFENCE IN DEPTH", title: "Safety center", description: "Control how your account can be accessed and how value can leave it." },
  settings: { eyebrow: "PREFERENCES", title: "Account settings", description: "Manage your profile, notifications, disclosures, and connected providers." }
};

function Header({ section }: { section: Section }) {
  const item = content[section];
  return <section className="pageIntro compact"><div><p className="eyebrow">{item.eyebrow}</p><h1>{item.title}</h1><p>{item.description}</p></div></section>;
}

function Assets() {
  return <><WalletWorkspace /><CrossChainWorkspace /></>;
}

function Earn() {
  return <EarnWorkspace />;
}

function Card() {
  return <div className="cardPageGrid"><section className="demoCardLarge unavailableCard"><div className="cardShine" /><div className="membershipTop"><span>AUREL</span><span>RESERVED</span></div><div className="cardChip" /><strong className="cardNumber">CARD PROGRAM NOT ACTIVE</strong><div className="membershipBottom"><span><small>ISSUING PARTNER</small>TO BE CONTRACTED</span><b>—</b></div></section><section className="panel cardControls"><p className="eyebrow">PROVIDER-GATED</p><h2>No card has been issued</h2><p>Card issuing, cardholder verification, safeguarding, and transaction compliance require an approved regulated program. This surface cannot create or simulate a live card.</p><div className="cardControlRow"><span><LockKeyhole size={18} /></span><div><strong>Card status</strong><small>No production issuing provider</small></div><span className="statusBadge neutral">Unavailable</span></div><div className="cardControlRow"><span><ShieldCheck size={18} /></span><div><strong>Planned controls</strong><small>Freeze, merchant, region, and velocity controls</small></div><span className="statusBadge neutral">Designed</span></div><div className="cardControlRow"><span><Smartphone size={18} /></span><div><strong>Digital wallet</strong><small>Subject to issuer and wallet approval</small></div><span className="statusBadge neutral">Future</span></div></section></div>;
}

function Benefits() {
  return <MembershipBenefits />;
}

function Security() {
  return <SecurityCenter />;
}

function Settings() {
  return <section className="panel settingsPanel"><div className="settingRow"><div><strong>Network mode</strong><small>Transactions use Base mainnet and always require wallet confirmation.</small></div><span className="statusBadge good">Mainnet</span></div><div className="settingRow"><div><strong>Base currency</strong><small>Used for future portfolio reporting.</small></div><span>USD</span></div><div className="settingRow"><div><strong>Privacy mode</strong><small>Balance masking is being prepared for a future release.</small></div><span className="statusBadge neutral">Planned</span></div><div className="settingRow"><div><strong>Documents and consents</strong><small>Product documentation is available from the sidebar.</small></div><span className="statusBadge neutral">Current</span></div></section>;
}

export function SectionPage({ section }: { section: Section }) {
  return <div><Header section={section} />{section === "assets" && <Assets />}{section === "earn" && <Earn />}{section === "borrow" && <BorrowWorkspace />}{section === "card" && <Card />}{section === "activity" && <ActivityWorkspace />}{section === "benefits" && <Benefits />}{section === "concierge" && <ConciergeWorkspace />}{section === "security" && <Security />}{section === "settings" && <Settings />}</div>;
}
