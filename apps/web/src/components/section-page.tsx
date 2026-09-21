import { ArrowRight, ChevronRight, LockKeyhole, Plane, ShieldCheck, Smartphone, Sparkles } from "lucide-react";
import { activity } from "@/data/demo";
import { WalletWorkspace } from "@/components/wallet-workspace";
import { EarnWorkspace } from "@/components/earn-workspace";
import { SecurityCenter } from "@/components/security-center";
import { BorrowWorkspace } from "@/components/borrow-workspace";

type Section = "assets" | "earn" | "borrow" | "card" | "activity" | "benefits" | "security" | "settings";

const content: Record<Section, { eyebrow: string; title: string; description: string }> = {
  assets: { eyebrow: "YOUR BALANCE SHEET", title: "Assets", description: "One coherent view across Aurel and the wallets you control elsewhere." },
  earn: { eyebrow: "PRODUCTIVE CAPITAL", title: "Earn", description: "Curated, transparent strategies with liquidity and risk explained before you allocate." },
  borrow: { eyebrow: "COLLATERALIZED LIQUIDITY", title: "Borrow", description: "Protocol-native credit with health factors, liquidation boundaries, and simulation before every signature." },
  card: { eyebrow: "GLOBAL SPEND", title: "Aurel Black", description: "A demonstration card connected to your liquid stablecoin reserve." },
  activity: { eyebrow: "AUDITABLE HISTORY", title: "Activity", description: "Every movement, authorization, fee, and status in one timeline." },
  benefits: { eyebrow: "RELATIONSHIP BENEFITS", title: "Black membership", description: "Practical benefits that become more valuable as your relationship deepens." },
  security: { eyebrow: "DEFENCE IN DEPTH", title: "Safety center", description: "Control how your account can be accessed and how value can leave it." },
  settings: { eyebrow: "PREFERENCES", title: "Account settings", description: "Manage your profile, notifications, disclosures, and connected providers." }
};

function Header({ section }: { section: Section }) {
  const item = content[section];
  return <section className="pageIntro compact"><div><p className="eyebrow">{item.eyebrow}</p><h1>{item.title}</h1><p>{item.description}</p></div></section>;
}

function Assets() {
  return <WalletWorkspace />;
}

function Earn() {
  return <EarnWorkspace />;
}

function Card() {
  return <div className="cardPageGrid"><section className="demoCardLarge"><div className="cardShine" /><div className="membershipTop"><span>AUREL</span><span>BLACK</span></div><div className="cardChip" /><strong className="cardNumber">4829&nbsp;&nbsp;7710&nbsp;&nbsp;3058&nbsp;&nbsp;1842</strong><div className="membershipBottom"><span><small>CARDHOLDER</small>ALEX MORGAN</span><span><small>VALID THRU</small>09/29</span><b>VISA</b></div></section><section className="panel cardControls"><p className="eyebrow">DEMONSTRATION CARD</p><h2>Ready when Bridge approves</h2><p>This card is a functional product simulation. No card has been issued and no real-world authorization can occur.</p><div className="cardControlRow"><span><LockKeyhole size={18} /></span><div><strong>Card status</strong><small>Sandbox only</small></div><span className="statusBadge neutral">Not issued</span></div><div className="cardControlRow"><span><ShieldCheck size={18} /></span><div><strong>Spend controls</strong><small>All regions · $5,000 daily</small></div><ChevronRight size={17} /></div><div className="cardControlRow"><span><Smartphone size={18} /></span><div><strong>Digital wallet</strong><small>Available after production approval</small></div><ChevronRight size={17} /></div></section></div>;
}

function ActivitySection() {
  return <section className="panel widePanel"><div className="activityList expanded">{activity.concat([{ title: "Wallet connected", detail: "Ledger external · Read-only", amount: "$43,000.00", status: "Connected", date: "15 Sep, 10:12", tone: "neutral" }]).map((item) => <div className="activityRow" key={`${item.title}-${item.date}`}><span className={`activityIcon ${item.tone}`}>{item.amount.startsWith("+") ? "+" : "↗"}</span><div><strong>{item.title}</strong><small>{item.detail} · {item.date}</small></div><div className="activityAmount"><strong>{item.amount}</strong><small>{item.status}</small></div></div>)}</div></section>;
}

function Benefits() {
  const benefits = [{ icon: Plane, title: "Airport lounges", note: "4 visits each membership year", state: "Planned" },{ icon: Smartphone, title: "Global eSIM", note: "3 GB annual travel data", state: "Planned" },{ icon: ShieldCheck, title: "Travel protection", note: "Subject to country and policy eligibility", state: "Review" },{ icon: Sparkles, title: "Private concierge", note: "Travel, dining, events, and account assistance", state: "Eligible" }];
  return <div className="benefitGrid">{benefits.map(({ icon: Icon, title, note, state }) => <article className="panel benefitCard" key={title}><span className="benefitIcon"><Icon size={21} /></span><span className="statusBadge neutral">{state}</span><h3>{title}</h3><p>{note}</p><button>View entitlement <ArrowRight size={15} /></button></article>)}</div>;
}

function Security() {
  return <SecurityCenter />;
}

function Settings() {
  return <section className="panel settingsPanel"><div className="settingRow"><div><strong>Product mode</strong><small>Controls whether regulated integrations are active.</small></div><span className="statusBadge neutral">Demonstration</span></div><div className="settingRow"><div><strong>Base currency</strong><small>Used for portfolio and reporting.</small></div><button>USD <ChevronRight size={15} /></button></div><div className="settingRow"><div><strong>Privacy mode</strong><small>Hide balances when the app opens.</small></div><button>Off <ChevronRight size={15} /></button></div><div className="settingRow"><div><strong>Documents and consents</strong><small>Review agreements and accepted disclosures.</small></div><button>Review <ChevronRight size={15} /></button></div></section>;
}

export function SectionPage({ section }: { section: Section }) {
  return <div><Header section={section} />{section === "assets" && <Assets />}{section === "earn" && <Earn />}{section === "borrow" && <BorrowWorkspace />}{section === "card" && <Card />}{section === "activity" && <ActivitySection />}{section === "benefits" && <Benefits />}{section === "security" && <Security />}{section === "settings" && <Settings />}</div>;
}
