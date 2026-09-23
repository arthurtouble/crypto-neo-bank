import Link from "next/link";
import { ArrowRight, ArrowUpRight, Check, ChevronDown, LockKeyhole, ShieldCheck, Wallet } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { GrowthTracker } from "@/components/growth-tracker";

const docs = "https://aurel-docs.aurel-events.workers.dev";
const faqs = [
  { question: "What is Aurel?", answer: "Aurel is a private-beta workspace for supported digital assets. It brings wallet activity, asset views, and transaction checks into one place." },
  { question: "Is the waitlist open worldwide?", answer: "Yes. You can join the waitlist from anywhere with an email address. Product access is offered gradually and depends on where we can operate." },
  { question: "Does joining guarantee access?", answer: "No. Joining means we can contact you about the private beta. It does not create an account or guarantee an invitation." },
  { question: "Do I need to connect a wallet now?", answer: "No. The waitlist only asks for your email. If you receive an invitation, you can review the available account options then." },
  { question: "Are rewards live?", answer: "No. Rewards and membership benefits are planned, not available today. We’ll explain eligibility, providers, and terms before any benefit launches." },
  { question: "What can I do in the private beta?", answer: "Eligible invited members can connect supported wallets, view selected Base assets, review activity, and prepare supported transfers. Some routes are read-only or paused until checks and providers are ready." },
  { question: "Where can I learn more?", answer: "The documentation covers current product status, security, supported assets, and the boundaries of the private beta." }
];

function Preview() {
  return <div className="landingPreview" aria-label="Illustrative Aurel interface showing product sections without account data">
    <div className="landingPreviewBar"><span className="landingPreviewMark">A</span><span>Overview</span><span className="landingPreviewPill">INTERFACE PREVIEW</span></div>
    <div className="landingPreviewBody">
      <div className="landingPreviewSidebar"><span className="selected">Overview</span><span>Assets</span><span>Activity</span><span>Security</span></div>
      <div className="landingPreviewContent"><p className="landingPreviewOverline">YOUR WORKSPACE</p><h3>Everything in view.</h3><p>See supported assets, then decide what to do next.</p>
        <div className="landingPreviewRows"><div><span className="landingPreviewIcon">◈</span><span><strong>Wallets & assets</strong><small>Connected sources, clearly labeled</small></span><ArrowUpRight size={17} /></div><div><span className="landingPreviewIcon">↗</span><span><strong>Activity</strong><small>Actions and their evidence</small></span><ArrowUpRight size={17} /></div><div><span className="landingPreviewIcon">✓</span><span><strong>Safety checks</strong><small>Review before you sign</small></span><ArrowUpRight size={17} /></div></div>
      </div>
    </div>
    <div className="landingPreviewFoot"><span><span className="landingStatusDot" /> Private beta interface</span><span>No account data shown</span></div>
  </div>;
}

export default function MarketingPage() {
  return <div className="landingPage">
    <GrowthTracker eventName="landing_viewed" contentId="landing-global-waitlist-v1" />
    <header className="landingHeader"><Brand /><nav aria-label="Main navigation"><a href="#product">Product</a><a href="#up-next">Up next</a><a href="#faq">FAQ</a><a href={docs}>Docs</a></nav><div className="landingHeaderActions"><ThemeToggle /><Link href="/app" className="landingSignIn">Sign in</Link><Link href="/waitlist" className="button dark">Join waitlist</Link></div></header>
    <main>
      <section className="landingHero"><div className="landingHeroCopy"><p className="landingKicker"><span className="landingStatusDot" /> GLOBAL PRIVATE-BETA WAITLIST</p><h1>Your digital assets, without the guesswork.</h1><p>See what you hold. Understand what happens next. Stay in control of every action.</p><div className="landingHeroActions"><Link href="/waitlist" className="button dark large">Join waitlist <ArrowRight size={16} /></Link><a href="#product">Explore the product <ArrowRight size={15} /></a></div><small>One email to join. Access is limited by availability and eligibility.</small></div><Preview /></section>
      <div className="landingStrip"><span><Check size={16} /> Customer-controlled signing</span><span><ShieldCheck size={16} /> Checks before supported actions</span><span><LockKeyhole size={16} /> No Aurel token</span></div>
      <section className="landingSection" id="product"><div className="landingSectionHead"><p className="landingKicker">THE PRODUCT</p><h2>What Aurel does today</h2><p>A focused set of tools for invited members. Features and supported assets vary by account and location.</p></div><div className="landingFeatureGrid"><article><span className="landingFeatureIcon"><Wallet size={20} /></span><p className="landingLabel">AVAILABLE IN PRIVATE BETA</p><h3>One clear view</h3><p>Connect supported wallets and see selected Base assets together. Sources and asset status stay visible.</p><a href={`${docs}/product/wallets-and-assets/`}>Wallets and assets <ArrowUpRight size={15} /></a></article><article><span className="landingFeatureIcon"><ShieldCheck size={20} /></span><p className="landingLabel">AVAILABLE IN PRIVATE BETA</p><h3>Know before you act</h3><p>Review supported transfers and their checks before signing. Routes that cannot be verified remain paused.</p><a href={`${docs}/product/transaction-lifecycle/`}>How transactions work <ArrowUpRight size={15} /></a></article></div></section>
      <section className="landingSection landingFuture" id="up-next"><div className="landingSectionHead"><p className="landingKicker">LOOKING AHEAD</p><h2>What we're working toward</h2><p>These are plans, not live services or benefits. We’ll update the <a href={`${docs}/getting-started/status/`}>product status</a> as they change.</p></div><div className="landingFutureGrid"><article><span>01</span><h3>More ways to move</h3><p>Broader routes and everyday money tools, subject to safety checks and provider readiness.</p></article><article><span>02</span><h3>Membership & rewards</h3><p>Useful benefits with clear terms and eligibility. No reward or return is promised today.</p></article><article><span>03</span><h3>A fuller picture</h3><p>More supported sources, context, and controls in one consistent workspace.</p></article></div></section>
      <section className="landingDocs"><div><p className="landingKicker">GO DEEPER</p><h2>Clear details, when you want them.</h2><p>See what is available now, how Aurel approaches security, and which services are still in preview.</p></div><a href={docs} className="button secondary">Documentation <ArrowUpRight size={16} /></a></section>
      <section className="landingSection landingFaq" id="faq"><div className="landingSectionHead"><p className="landingKicker">COMMON QUESTIONS</p><h2>Frequently asked questions</h2></div><div className="landingFaqList">{faqs.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="landingClose"><p className="landingKicker">AUREL PRIVATE BETA</p><h2>Start with a clearer view.</h2><p>Join the waitlist. We’ll reach out if we can offer you access.</p><Link href="/waitlist" className="button dark large">Join waitlist <ArrowRight size={16} /></Link></section>
    </main>
    <footer className="landingFooter"><div className="landingFooterTop"><div className="landingFooterBrand"><Brand /><p>A considered workspace for digital assets.</p><small>Private beta. Product availability and eligibility vary.</small></div><div className="landingFooterLinks"><div><h2>Product</h2><Link href="/waitlist">Join waitlist</Link><Link href="/app">Sign in</Link><a href={`${docs}/getting-started/status/`}>Product status</a></div><div><h2>Explore</h2><a href={docs}>Docs home</a><a href={`${docs}/product/wallets-and-assets/`}>Wallets & assets</a><a href={`${docs}/company/roadmap/`}>Roadmap</a></div><div><h2>Safety</h2><a href={`${docs}/safety/security-model/`}>Security model</a><a href={`${docs}/safety/account-controls/`}>Account controls</a><a href={`${docs}/safety/report-a-security-issue/`}>Report an issue</a></div><div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a></div></div></div><div className="landingFooterBottom"><span>© {new Date().getFullYear()} Aurel</span><span>Independent by design. No house token.</span></div></footer>
  </div>;
}
