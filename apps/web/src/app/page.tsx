import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AppBrand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const features = [
  { title: "A home for all your assets", text: "Cash, vaults, and investments together.", href: "/app", image: "overview" },
  { title: "Spend", text: "Card controls built around you.", href: "/app/cards", image: "cards" },
  { title: "Earn", text: "A few vaults, with the risks in view.", href: "/app/earn", image: "earn" },
  { title: "Send", text: "An address, a saved contact, or an Aura tag.", href: "/app/send", image: "send" },
  { title: "Swap", text: "Crypto, tokenized stocks, and gold.", href: "/app/swap", image: "swap" },
  { title: "Security", text: "Your access, limits, and recovery in one place.", href: "/app/settings", image: "settings" }
] as const;
const faqs = [
  { question: "Can I explore Aura without an account?", answer: "Yes. Browse every section using clearly marked example data. Sign in to see your own records or take an action." },
  { question: "Where does my balance come from?", answer: "Supported wallet and protocol values come from public chains. Bank and card records come from their connected providers. Aura does not create a balance ledger." },
  { question: "Are bank transfers and cards available?", answer: "These depend on provider connection, eligibility, and country. Aura shows unavailable where a service is not connected." },
  { question: "How does an Aura tag work?", answer: "Members can create a public payment page. Crypto uses their verified wallet address. Bank transfer and card payment appear only when the relevant provider is connected." },
  { question: "Do I approve transactions?", answer: "Supported wallet actions require your confirmation. Availability and additional security checks depend on the action." }
];
const links = [{ label: "Features", href: "#features" }, { label: "Security", href: "#security" }, { label: "FAQs", href: "#faq" }, { label: "Docs", href: docs }];

/** A screen from the app, with fictional example data, framed like a window. */
function Screen({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }) {
  return <div className="ldScreen"><Image src={`/images/aura-${name}.png`} alt={alt} width={960} height={600} unoptimized priority={priority} /></div>;
}

/** The public landing page (redesign area 12): what Aura is, the app's own screens, questions, and where to go next. */
export default function MarketingPage() {
  return <div className="ldPage">
    <header className="ldHeader">
      <div className="ldHeaderInner">
        <AppBrand href="/" />
        <nav className="ldNav" aria-label="Main navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav>
        <details className="ldMobileNav"><summary>Menu <ChevronDown aria-hidden="true" /></summary>
          <nav aria-label="Mobile navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav></details>
        <div className="ldHeaderActions"><ThemeToggle /><Link className="appButton appButtonPrimary" href="/app">Get Started</Link></div>
      </div>
    </header>
    <main>
      <section className="ldHero">
        <div className="ldHeroCopy">
          <h1>Your Smart Account</h1>
          <p>Spend anywhere, invest in global markets, and earn on your money. All from one app.</p>
          <Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get Started</Link>
          <small>Explore with example data. Features vary by provider, country, and eligibility.<sup><a href="#footnotes">1</a></sup></small>
        </div>
        <Screen name="overview" alt="Aura overview showing fictional cash, vault, and portfolio data" priority />
      </section>
      <section className="ldFeatures" id="features" aria-labelledby="features-heading">
        <div className="ldSectionIntro"><h2 id="features-heading">Money, made clearer.</h2><p>One place to see what you hold and what you can do next.</p></div>
        {features.map((feature) => <article className="ldFeature" id={feature.title === "Security" ? "security" : undefined} key={feature.title}>
          <div className="ldFeatureCopy">
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
            {feature.title === "Security" && <ul className="ldFacts">
              <li>Self-Custodial<sup><a href="#footnotes">2</a></sup></li><li>Bank-Grade Partners<sup><a href="#footnotes">3</a></sup></li><li>Audits<sup><a href="#footnotes">4</a></sup></li></ul>}
            <Link className="appTextButton ldExplore" href={feature.href}>Explore<span className="srOnly"> {feature.title.toLowerCase()}</span></Link>
          </div>
          <Screen name={feature.image} alt={`Aura ${feature.title.toLowerCase()} screen with example data`} />
        </article>)}
      </section>
      <section className="ldFaq" id="faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Questions, answered.</h2>
        <div className="ldFaqList">{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </section>
      <section className="ldClosing"><h2>See what Aura can do.</h2><Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get Started</Link></section>
    </main>
    <footer className="ldFooter">
      <div className="ldFooterTop">
        <AppBrand href="/" />
        <div><h2>Product</h2><a href="#features">Features</a><Link href="/app">Explore Aura</Link><a href={`${docs}/getting-started/status/`}>Availability</a></div>
        <div><h2>Help</h2><a href={`${docs}/getting-started/setup/`}>Get started</a><a href={`${docs}/safety/account-controls/`}>Security</a><a href={`${docs}/safety/report-a-security-issue/`}>Contact</a></div>
        <div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div>
      </div>
      <ol id="footnotes" className="ldFootnotes">
        <li>Illustrative screens use fictional values. <a href={`${docs}/getting-started/status/`}>Check current availability</a>.</li>
        <li>Wallet control and recovery depend on the wallet type. <a href={`${docs}/safety/security-model/`}>How security works</a>.</li>
        <li>Bank and card features require connected, approved providers. <a href={`${docs}/company/provider-responsibilities/`}>Provider responsibilities</a>.</li>
        <li>Audits must be completed and published before an audited claim applies. <a href={`${docs}/safety/security-model/`}>Security status</a>.</li>
      </ol>
      <div className="ldFooterBottom">© {new Date().getFullYear()} Aura <ThemeToggle /></div>
    </footer>
    <Link className="ldMobileCta appButton appButtonPrimary appButtonLarge" href="/app">Get Started</Link>
  </div>;
}
