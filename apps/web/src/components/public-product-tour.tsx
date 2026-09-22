import Link from "next/link";
import { Eye, Headphones, Landmark, LockKeyhole, Route, ShieldCheck } from "lucide-react";
import { Brand } from "./brand";
import { GrowthTracker } from "./growth-tracker";
import { ThemeToggle } from "./theme-toggle";

const steps = [
  { number: "01", title: "See", copy: "Bring supported holdings and connected accounts into one clear view.", icon: Eye, state: "Available in private beta" },
  { number: "02", title: "Protect", copy: "Set account controls and review the destination, amount, and risk before signing.", icon: ShieldCheck, state: "Available in private beta" },
  { number: "03", title: "Receive", copy: "Use clear account details for supported digital assets.", icon: Landmark, state: "Digital assets available · bank rails require provider activation" },
  { number: "04", title: "Move", copy: "Send or exchange USD Coin without choosing the underlying route yourself.", icon: Route, state: "Available when a live route is quoted" },
  { number: "05", title: "Get Help", copy: "Open a traceable support request or ask for human assistance when something needs investigation.", icon: Headphones, state: "Support available · lifestyle concierge requires provider activation" }
];

export function PublicProductTour() {
  return <div className="tourPage"><GrowthTracker eventName="product_tour_viewed" contentId="product-tour-v1" /><header className="publicFlowHeader"><Brand /><div><Link href="/">Home</Link><ThemeToggle /><Link className="button primary" href="/apply">Apply</Link></div></header><main className="tourMain"><section className="tourHero"><p className="eyebrow"><LockKeyhole size={14} /> PRODUCT TOUR</p><h1>Finance without the machinery.</h1><p>Aurel brings digital assets, account controls, and selected financial services into one calm interface. You still approve every transaction.</p></section><div className="tourSteps">{steps.map(({ icon: Icon, ...step }) => <article key={step.number}><span className="tourNumber">{step.number}</span><span className="tourIcon"><Icon size={22} /></span><div><h2>{step.title}</h2><p>{step.copy}</p><small>{step.state}</small></div><div className="tourMock" aria-hidden="true"><i /><i /><i /></div></article>)}</div><section className="tourCta"><p className="eyebrow">PRIVATE ACCESS</p><h2>Start with what you need.</h2><p>Applications are reviewed in small cohorts. No deposit is required to apply.</p><Link className="button primary large" href="/apply">Apply for Private Access</Link></section></main></div>;
}
