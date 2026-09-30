import Image from "next/image";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { AppBrand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const features = [
  { title: "Everything you hold, in one place", text: "Cash, crypto, tokenized stocks, gold, and what you've put to work, all valued in dollars.", href: "/app", image: "overview" },
  { title: "Send", text: "Pay an address, a saved recipient, or an Aura tag. A new address gets a second look before you confirm.", href: "/app/send", image: "send" },
  { title: "Swap", text: "Move between crypto, tokenized stocks, and gold. You see the fees and the price before you confirm.", href: "/app/swap", image: "swap" },
  { title: "Earn", text: "A few lending markets and vaults, with the risks shown next to the rate.", href: "/app/earn", image: "earn" },
  { title: "Spend with a card", text: "A virtual Visa card that spends your USDC, with a freeze and limits you set. Coming soon.", href: "/app/cards", image: "cards" },
  { title: "Security", text: "Your passkey, your limits, and an emergency lock, all in Settings.", href: "/app/settings", image: "settings" }
] as const;
const faqs = [
  { question: "Can I look around without an account?", answer: "Yes. Every section works with example data, clearly labelled. Sign in when you want to see your own money or do something with it." },
  { question: "Where does my balance come from?", answer: "From the blockchains and protocols that hold your money, read when you open the app. Bank and card records come from our partners. Aura doesn't keep a balance ledger of its own." },
  { question: "Can I use bank transfers and cards?", answer: "Not yet. Both need our banking and card partners to approve Aura, and both will depend on where you live. Until then, the app shows them as coming soon." },
  { question: "How does an Aura tag work?", answer: "It's a short public name, like @sam, with its own payment page. People can pay you there in crypto, and by bank transfer if you choose to show your bank details." },
  { question: "Do I approve every transaction?", answer: "Yes. Every send, swap, and Earn move waits for you to review it and confirm it with your passkey." }
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
        <div className="ldHeaderActions"><ThemeToggle /><Link className="appButton appButtonPrimary" href="/app">Get started</Link></div>
      </div>
    </header>
    <main>
      <section className="ldHero">
        <div className="ldHeroCopy">
          <h1>One app for the money you hold yourself</h1>
          <p>See every balance, then send, swap, or earn. You approve each transaction, and you see the fees and risks first.</p>
          <Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link>
          <small>Try it with example data first. What you can use depends on where you live and on our partners.<sup><a href="#footnotes">1</a></sup></small>
        </div>
        <Screen name="overview" alt="Aura's Overview with example balances" priority />
      </section>
      <section className="ldFeatures" id="features" aria-labelledby="features-heading">
        <div className="ldSectionIntro"><h2 id="features-heading">What you can do</h2><p>Each part of the app works with example data, so you can try it before you sign up.</p></div>
        {features.map((feature) => <article className="ldFeature" id={feature.title === "Security" ? "security" : undefined} key={feature.title}>
          <div className="ldFeatureCopy">
            <h3>{feature.title}</h3>
            <p>{feature.text}</p>
            {feature.title === "Security" && <ul className="ldFacts">
              <li>You hold your keys<sup><a href="#footnotes">2</a></sup></li><li>A passkey for every payment</li><li>An emergency lock</li></ul>}
            {feature.image === "cards" && <p className="ldNote">Cards and bank transfers need approved partners.<sup><a href="#footnotes">3</a></sup></p>}
            <Link className="appTextButton ldExplore" href={feature.href}>Explore<span className="srOnly"> {feature.title.toLowerCase()}</span></Link>
          </div>
          <Screen name={feature.image} alt={`Aura's ${feature.href === "/app" ? "Overview" : feature.href.split("/").pop()} screen with example data`} />
        </article>)}
      </section>
      <section className="ldFaq" id="faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Questions</h2>
        <div className="ldFaqList">{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </section>
      <section className="ldClosing"><h2>Look around with example data</h2><Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link></section>
    </main>
    <footer className="ldFooter">
      <div className="ldFooterTop">
        <AppBrand href="/" />
        <div><h2>Product</h2><a href="#features">Features</a><Link href="/app">Explore Aura</Link><a href={`${docs}/getting-started/status/`}>Availability</a></div>
        <div><h2>Help</h2><a href={`${docs}/getting-started/setup/`}>Get started</a><a href={`${docs}/safety/account-controls/`}>Security</a><a href={`${docs}/safety/report-a-security-issue/`}>Contact</a></div>
        <div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div>
      </div>
      <ol id="footnotes" className="ldFootnotes">
        <li>The screens show example values, not real accounts. <a href={`${docs}/getting-started/status/`}>See what&apos;s available now</a>.</li>
        <li>How you control and recover your wallet depends on how you signed up. <a href={`${docs}/safety/security-model/`}>How security works</a>.</li>
        <li>Bank transfers and cards need connected, approved partners. <a href={`${docs}/company/provider-responsibilities/`}>Who does what</a>.</li>
      </ol>
      <div className="ldFooterBottom">© {new Date().getFullYear()} Aura <ThemeToggle /></div>
    </footer>
    <Link className="ldMobileCta appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link>
  </div>;
}
