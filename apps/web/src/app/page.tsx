import Image from "next/image";
import Link from "next/link";
import { ArrowRight, ChevronDown } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const features = [
  { title: "A home for all your assets", text: "Cash, vaults, and investments together.", href: "/app", image: "overview" },
  { title: "Spend", text: "Card controls built around you.", href: "/app/cards", image: "cards" },
  { title: "Earn", text: "A few vaults, with the risks in view.", href: "/app/earn", image: "earn" },
  { title: "Send", text: "An address, a saved contact, or an Aura tag.", href: "/app/send", image: "send" },
  { title: "Invest", text: "Explore crypto and eligible markets.", href: "/app/invest", image: "invest" },
  { title: "Borrow", text: "Understand debt before you borrow or repay.", href: "/app/borrow", image: "borrow" },
  { title: "Rewards", text: "Cashback and benefits when available.", href: "/app/rewards", image: "rewards" },
  { title: "Security", text: "Your access, limits, and recovery in one place.", href: "/app/settings", image: "settings" }
] as const;
const faqs = [
  { question: "Can I explore Aura without an account?", answer: "Yes. Browse every section using clearly marked example data. Sign in to see your own records or take an action." },
  { question: "Where does my balance come from?", answer: "Supported wallet and protocol values come from public chains. Bank and card records come from their connected providers. Aura does not create a balance ledger." },
  { question: "Are bank transfers, cards, and rewards available?", answer: "These depend on provider connection, eligibility, and country. Aura shows unavailable where a service is not connected." },
  { question: "How does an Aura tag work?", answer: "Members can create a public payment page. Crypto uses their verified wallet address. Bank transfer and card payment appear only when the relevant provider is connected." },
  { question: "Do I approve transactions?", answer: "Supported wallet actions require your confirmation. Availability and additional security checks depend on the action." }
];

export default function MarketingPage() {
  return <div className="auraLanding">
    <header className="auraLandingHeader"><Brand /><nav aria-label="Main navigation"><a href="#features">Features</a><a href="#security">Security</a><a href="#faq">FAQs</a><a href={docs}>Docs</a></nav><details className="auraLandingMobileNav"><summary>Menu <ChevronDown size={15} aria-hidden="true" /></summary><nav aria-label="Mobile navigation"><a href="#features">Features</a><a href="#security">Security</a><a href="#faq">FAQs</a><a href={docs}>Docs</a></nav></details><div className="auraLandingHeaderActions"><ThemeToggle /><Link className="button primary" href="/app">Get Started</Link></div></header>
    <main>
      <section className="auraHero"><div className="auraHeroCopy"><h1>Your Smart Account</h1><p>Spend anywhere, invest in global markets, and get incredible rewards. All from one app.</p><Link className="button primary large" href="/app">Get Started <ArrowRight size={17} /></Link><small>Explore with example data. Features vary by provider, country, and eligibility.<sup><a href="#footnotes">1</a></sup></small></div><div className="auraHeroImage"><Image src="/images/aura-overview.png" alt="Aura overview showing fictional cash, vault, and portfolio data" width={960} height={600} unoptimized priority /></div></section>
      <section className="auraFeatures" id="features"><div className="auraSectionIntro"><h2>Money, made clearer.</h2><p>One place to see what you hold and what you can do next.</p></div><div className="auraFeatureGrid">{features.map((feature) => <article className="auraFeature" id={feature.title === "Security" ? "security" : undefined} key={feature.title}><div className="auraFeatureCopy"><h3>{feature.title}</h3><p>{feature.text}</p><Link href={feature.href}>Explore <ArrowRight size={15} /></Link></div><div className="auraFeatureMedia"><Image src={`/images/aura-${feature.image}.png`} alt={`Aura ${feature.title.toLowerCase()} screen with example data`} width={960} height={600} unoptimized /></div>{feature.title === "Security" && <div className="auraSecurityFacts"><span>Self-Custodial<sup><a href="#footnotes">2</a></sup></span><span>Bank-Grade Partners<sup><a href="#footnotes">3</a></sup></span><span>Audits<sup><a href="#footnotes">4</a></sup></span></div>}</article>)}</div></section>
      <section className="auraFaq" id="faq"><h2>Questions, answered.</h2><div>{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div></section>
      <section className="auraClosing"><h2>See what Aura can do.</h2><Link className="button primary large" href="/app">Get Started <ArrowRight size={17} /></Link></section>
    </main>
    <footer className="auraFooter"><div className="auraFooterTop"><Brand /><div><h2>Product</h2><a href="#features">Features</a><Link href="/app">Explore Aura</Link><a href={`${docs}/getting-started/status/`}>Availability</a></div><div><h2>Help</h2><a href={`${docs}/getting-started/setup/`}>Get started</a><a href={`${docs}/safety/account-controls/`}>Security</a><a href={`${docs}/safety/report-a-security-issue/`}>Contact</a></div><div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div></div><ol id="footnotes" className="auraFootnotes"><li>Illustrative screens use fictional values. <a href={`${docs}/getting-started/status/`}>Check current availability</a>.</li><li>Wallet control and recovery depend on the wallet type. <a href={`${docs}/safety/security-model/`}>How security works</a>.</li><li>Bank and card features require connected, approved providers. <a href={`${docs}/company/provider-responsibilities/`}>Provider responsibilities</a>.</li><li>Audits must be completed and published before an audited claim applies. <a href={`${docs}/safety/security-model/`}>Security status</a>.</li></ol><div className="auraFooterBottom">© {new Date().getFullYear()} Aura <ThemeToggle /></div></footer>
    <Link className="auraMobileCta button primary" href="/app">Get Started <ArrowRight size={17} /></Link>
  </div>;
}
