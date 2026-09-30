import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { ArrowLeftRight, AtSign, Check, ChevronDown, CreditCard, Send, Sprout, Wallet } from "lucide-react";
import { AppBrand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = { alternates: { canonical: "/" } };

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const features = [
  { icon: Wallet, title: "Every balance", text: "Stablecoins, crypto, tokenized stocks, and gold, valued in dollars." },
  { icon: Send, title: "Send", text: "Pay an address, a saved contact, or an Aura tag. New addresses get a second check." },
  { icon: ArrowLeftRight, title: "Swap", text: "Move between crypto, stocks, and gold. See the price and fees before you confirm." },
  { icon: Sprout, title: "Earn", text: "Lend through Aave or a Morpho vault, with the risks next to the rate." },
  { icon: AtSign, title: "Aura tag", text: "A short name like @sam, with its own page where people can pay you." },
  { icon: CreditCard, title: "Card", text: "A virtual Visa card that spends your USDC.", soon: true }
];
const safeguards = ["We never hold your keys or your money", "Your passkey confirms every payment", "Daily limits, saved contacts, and an emergency lock"];
const faqs = [
  { question: "Can I try it without an account?", answer: "Yes. Every screen works with example data, clearly labelled. Sign in when you want to use your own money." },
  { question: "Where do my balances come from?", answer: "From the blockchains and protocols that hold your money, read each time you open the app. Aura doesn't keep a ledger of its own." },
  { question: "Can I use bank transfers and cards?", answer: "Not yet. Both need our banking and card partners to approve Aura, and both will depend on where you live." },
  { question: "Do I approve every transaction?", answer: "Yes. Every send, swap, and Earn move waits for you to review it and confirm it with your passkey." }
];
const links = [{ label: "Features", href: "#features" }, { label: "Security", href: "#security" }, { label: "Questions", href: "#faq" }, { label: "Docs", href: docs }];

/** A screen from the app, with fictional example data. */
function Screen({ name, alt, priority = false }: { name: string; alt: string; priority?: boolean }) {
  return <div className="ldScreen"><Image src={`/images/aura-${name}.png`} alt={alt} width={960} height={600} unoptimized priority={priority} /></div>;
}

/** The public landing page: what Aura is, what it does, how it keeps money safe, and where to start. */
export default function MarketingPage() {
  return <div className="ldPage">
    <header className="ldHeader">
      <div className="ldHeaderInner">
        <AppBrand href="/" />
        <nav className="ldNav" aria-label="Main navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav>
        <details className="ldMobileNav"><summary>Menu <ChevronDown aria-hidden="true" /></summary>
          <nav aria-label="Mobile navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav></details>
        <div className="ldHeaderActions"><ThemeToggle /><Link className="appButton appButtonPrimary" href="/app">Get started</Link></div>
      </div>
    </header>
    <main>
      <section className="ldHero">
        <h1>Money you control, in one simple app</h1>
        <p>Hold stablecoins, crypto, tokenized stocks, and gold. Send, swap, and earn from one wallet, and confirm every move with your passkey.</p>
        <div className="ldActions">
          <Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link>
          <a className="appButton appButtonLarge" href="#features">See what it does</a>
        </div>
        <small>Try it with example data first. No account needed.</small>
      </section>
      <div className="ldShowcase"><Screen name="overview" alt="Aura's Overview with example balances" priority /></div>

      <section className="ldSection" id="features" aria-labelledby="features-heading">
        <div className="ldIntro"><h2 id="features-heading">Everything in one place</h2><p>One wallet for what you hold and what you do with it.</p></div>
        <ul className="ldGrid">{features.map(({ icon: Icon, title, text, soon }) => <li key={title}>
          <span className="ldIcon" aria-hidden="true"><Icon /></span>
          <h3>{title}{soon && <span className="ldSoon">Coming soon</span>}</h3>
          <p>{text}</p>
        </li>)}</ul>
      </section>

      <section className="ldSection ldSplit" id="security" aria-labelledby="security-heading">
        <div className="ldIntro">
          <h2 id="security-heading">Only you can move your money</h2>
          <p>Aura prepares each payment. You check it and confirm it. Nobody at Aura can do it for you.</p>
          <ul className="ldChecks">{safeguards.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
          <a className="appTextButton ldMore" href={`${docs}/safety/security-model/`}>How security works</a>
        </div>
        <Screen name="settings" alt="Aura's security settings with example data" />
      </section>

      <section className="ldSection ldFaq" id="faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Questions</h2>
        <div className="ldFaqList">{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </section>

      <section className="ldSection ldClosing"><h2>See it for yourself</h2><p>Every screen works with example data.</p><Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link></section>
    </main>
    <footer className="ldFooter">
      <div className="ldFooterTop">
        <AppBrand href="/" />
        <div><h2>Product</h2><a href="#features">Features</a><Link href="/app">Try Aura</Link><a href={`${docs}/getting-started/status/`}>Availability</a></div>
        <div><h2>Help</h2><a href={`${docs}/getting-started/setup/`}>Get started</a><a href={`${docs}/safety/account-controls/`}>Security</a><a href={`${docs}/safety/report-a-security-issue/`}>Contact</a></div>
        <div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div>
      </div>
      <p className="ldDisclosure">Screens show example data, not real accounts. What you can use depends on where you live. Bank transfers and cards need approved partners. <a href={`${docs}/getting-started/status/`}>See what&apos;s available now</a>.</p>
      <div className="ldFooterBottom">© {new Date().getFullYear()} Aura <ThemeToggle /></div>
    </footer>
    <Link className="ldMobileCta appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link>
  </div>;
}
