import type { Metadata } from "next";
import Link from "next/link";
import { ArrowDownToLine, ArrowLeftRight, AtSign, CandlestickChart, Check, ChevronDown, CirclePercent, CreditCard, Send, Sprout } from "lucide-react";
import { AppBrand } from "@/components/brand";
import { LandingMobileCta } from "@/components/landing-mobile-cta";
import { ThemeToggle } from "@/components/theme-toggle";
import { jsonLd, landingDescription, landingStructuredData, landingTitle, shareImage } from "@/lib/site/seo";

export const metadata: Metadata = {
  title: { absolute: landingTitle },
  alternates: { canonical: "/" },
  openGraph: { type: "website", siteName: "Aura", url: "/", title: landingTitle, description: landingDescription, images: [shareImage] },
  twitter: { card: "summary_large_image", title: landingTitle, description: landingDescription, images: [shareImage.url] }
};

const docs = process.env.NEXT_PUBLIC_DOCS_URL ?? "https://aurel-docs.aurel-events.workers.dev";
const features = [
  { icon: ArrowDownToLine, title: "Add money", text: "Receive crypto from an exchange or another wallet, or buy USDC with a card. Everything you hold shows in dollars." },
  { icon: Send, title: "Send", text: "Pay an address, a saved contact, or an Aura tag. New addresses get a second check." },
  { icon: ArrowLeftRight, title: "Swap", text: "Move between crypto, stocks, and gold. See the price and fees before you confirm." },
  { icon: Sprout, title: "Earn", text: "Lend your USDC to earn interest, with the risks next to the rate." },
  // Built, not switched on in production yet (docs: getting-started/status). Each partner decides where it's offered.
  { icon: CandlestickChart, title: "Perps", text: "Trade crypto and stock prices up or down on Hyperliquid, with leverage that makes gains and losses bigger.", soon: true, where: true },
  { icon: CirclePercent, title: "Predictions", text: "Buy Yes or No on real-world events, like crypto prices and elections, on Polymarket.", soon: true, where: true },
  { icon: AtSign, title: "Aura tag", text: "A short name like @sam, with its own page where people can pay you." },
  { icon: CreditCard, title: "Card", text: "A virtual Visa card that spends your USDC.", soon: true }
];
const safeguards = ["We never hold your keys or your money", "Your passkey confirms every payment", "Daily limits, saved contacts, and an emergency lock"];
const faqs = [
  { question: "Can I try it without an account?", answer: "Yes. Every screen works with example data, clearly labelled. Sign in when you want to use your own money." },
  { question: "Where do my balances come from?", answer: "From the blockchains and partners that hold your money, read each time you open the app. Aura doesn't keep a ledger of its own." },
  { question: "Can I use bank transfers and cards?", answer: "Bank transfers work once our banking partner approves Aura. The card is coming soon. Both depend on where you live." },
  { question: "Do I approve every transaction?", answer: "Yes. Every send, swap, Earn move, and prediction waits for you to review it and confirm it with your passkey. For Perps, your passkey approves a trading key on your device once. Only you can trade with it, and it can't move money out." }
];
const links = [{ label: "Features", href: "#features" }, { label: "Security", href: "#security" }, { label: "Questions", href: "#faq" }, { label: "Docs", href: docs }];

/**
 * A screen from the app, with fictional example data, in WebP drawn larger than it shows (tests/inventory/landing-screens.spec.ts
 * makes them). A plain image, since there is nothing for an image optimiser to do; the first one loads eagerly because it's
 * the largest thing above the fold. `phone` is a phone's screen; `phoneBelow` swaps a computer's screen for the phone's on
 * screens narrower than 768px, where a computer's screen would be too small to read.
 */
function Screen({ name, alt, phone = false, phoneBelow = false, priority = false }: { name: string; alt: string; phone?: boolean; phoneBelow?: boolean; priority?: boolean }) {
  const src = (file: string, theme: "light" | "dark") => `/images/aura-${file}${theme === "dark" ? "-dark" : ""}.webp`;
  const size = (isPhone: boolean) => isPhone ? { width: 780, height: 1520 } : { width: 1920, height: 1200 };
  // One shot per theme; public.css shows the one that matches the page.
  return <div className={phone ? "ldScreen ldScreenPhone" : "ldScreen"}>{(["light", "dark"] as const).map((theme) => <picture key={theme} className={`ldScreen-${theme}`}>
    {phoneBelow && <source media="(max-width: 767px)" srcSet={src(`${name}-phone`, theme)} {...size(true)} />}
    <img src={src(phone ? `${name}-phone` : name, theme)} alt={alt} {...size(phone)} decoding="async" loading={priority ? "eager" : "lazy"} fetchPriority={priority ? "high" : "auto"} />
  </picture>)}</div>;
}

/** The public landing page: what Aura is, what it does, how it keeps money safe, and where to start. */
export default function MarketingPage() {
  return <div className="ldPage">
    <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd(landingStructuredData(faqs)) }} />
    <header className="ldHeader">
      <div className="ldHeaderInner">
        <AppBrand href="/" />
        <nav className="ldNav" aria-label="Main navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}</nav>
        <details className="ldMobileNav"><summary>Menu <ChevronDown aria-hidden="true" /></summary>
          <nav aria-label="Mobile navigation">{links.map((link) => <a key={link.label} href={link.href}>{link.label}</a>)}<Link href="/app?sign-in">Sign in</Link></nav></details>
        <div className="ldHeaderActions"><ThemeToggle /><Link className="appButton" href="/app?sign-in">Sign in</Link>
          <Link className="appButton appButtonPrimary" href="/app">Get started</Link></div>
      </div>
    </header>
    <main>
      <section className="ldHero">
        <h1>Money you control, in one simple app</h1>
        <p>Hold stablecoins, crypto, stocks, and gold. Send, swap, and earn from one wallet, and confirm every payment with your passkey.</p>
        <div className="ldActions">
          <Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link>
        </div>
        <small>Try it with example data first. No account needed.</small>
      </section>
      <div className="ldShowcase"><Screen name="overview" alt="Aura's Overview with example balances" phoneBelow priority /></div>

      <section className="ldSection" id="features" aria-labelledby="features-heading">
        <div className="ldIntro"><h2 id="features-heading">Everything in one place</h2><p>One wallet for what you hold and what you do with it.</p></div>
        <ul className="ldGrid">{features.map(({ icon: Icon, title, text, soon, where }) => <li key={title}>
          <span className="ldIcon" aria-hidden="true"><Icon /></span>
          <h3>{title}{soon && <span className="ldSoon">Coming soon</span>}</h3>
          <p>{text}</p>
          {where && <a className="appTextButton ldMore" href={`${docs}/product/markets/#where-they-work`}>Where {title} is available</a>}
        </li>)}</ul>
      </section>

      <section className="ldSection ldSplit" id="security" aria-labelledby="security-heading">
        <div className="ldIntro">
          <h2 id="security-heading">Only you can move your money</h2>
          <p>Aura prepares each payment. You check it and confirm it. Nobody at Aura can do it for you.</p>
          <ul className="ldChecks">{safeguards.map((item) => <li key={item}><Check aria-hidden="true" />{item}</li>)}</ul>
          <a className="appTextButton ldMore" href={`${docs}/safety/security-model/`}>How security works</a>
        </div>
        <Screen name="settings" alt="Aura's security settings on a phone, with example data" phone />
      </section>

      <section className="ldSection ldFaq" id="faq" aria-labelledby="faq-heading"><h2 id="faq-heading">Questions</h2>
        <div className="ldFaqList">{faqs.map((item) => <details key={item.question}><summary>{item.question}<ChevronDown aria-hidden="true" /></summary><p>{item.answer}</p></details>)}</div>
      </section>

      <section className="ldSection ldClosing"><h2>See it for yourself</h2><p>Every screen works with example data.</p><Link className="appButton appButtonPrimary appButtonLarge" href="/app">Get started</Link></section>
    </main>
    <footer className="ldFooter">
      <div className="ldFooterTop">
        <AppBrand href="/" />
        <div><p className="ldFooterLabel">Product</p><a href="#features">Features</a><Link href="/app">Get started</Link><a href={`${docs}/getting-started/status/`}>Availability</a></div>
        <div><p className="ldFooterLabel">Help</p><a href={`${docs}/help/faq/`}>Questions</a><a href={`${docs}/safety/account-controls/`}>Security</a><Link href="/app/support">Contact</Link></div>
        <div><p className="ldFooterLabel">Legal</p><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div>
      </div>
      <p className="ldDisclosure">Screens show example data, not real accounts. What you can use depends on where you live. Bank transfers and cards need approved partners. <a href={`${docs}/getting-started/status/`}>See what&apos;s available now</a>.</p>
      <div className="ldFooterBottom">© {new Date().getFullYear()} Aura</div>
    </footer>
    <LandingMobileCta />
  </div>;
}
