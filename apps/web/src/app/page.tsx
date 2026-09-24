import Link from "next/link";
import { ArrowRight, ArrowUpRight, ChevronDown, ShieldCheck, Wallet } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";
import { GrowthTracker } from "@/components/growth-tracker";

const docs = "https://aurel-docs.aurel-events.workers.dev";
const faqs = [
  { question: "What can I do in Aurel?", answer: "Invited members can see selected Base assets and wallet activity. Supported actions include checks before signing; some routes are paused." },
  { question: "Is the waitlist free?", answer: "Yes. You only need an email. No account or deposit is required." },
  { question: "Can I join from anywhere?", answer: "Yes. The waitlist is global, but product access depends on location, eligibility, and available places." },
  { question: "Will I get an invitation?", answer: "Not necessarily. We’ll email you if we can offer you access." },
  { question: "Who approves transactions?", answer: "You approve supported actions in your wallet. Aurel cannot sign for you." },
  { question: "Are rewards available?", answer: "Not yet. Rewards and membership benefits are plans, not live features." },
  { question: "How do you use my email?", answer: "We encrypt it and use it to contact you about access. We may also store an approximate country hint from your IP. See the privacy notice for details." }
];

function Preview() {
  return <div className="landingPreview" aria-label="Illustrative Aurel interface showing product sections without account data">
    <div className="landingPreviewBar"><span className="landingPreviewMark">A</span><span>Overview</span><span className="landingPreviewPill">INTERFACE PREVIEW</span></div>
    <div className="landingPreviewBody">
      <div className="landingPreviewSidebar"><span className="selected">Overview</span><span>Assets</span><span>Activity</span><span>Security</span></div>
      <div className="landingPreviewContent"><p className="landingPreviewOverline">YOUR WORKSPACE</p><h3>Overview</h3>
        <div className="landingPreviewRows"><div><span className="landingPreviewIcon">◈</span><span><strong>Assets</strong></span><ArrowUpRight size={17} /></div><div><span className="landingPreviewIcon">↗</span><span><strong>Activity</strong></span><ArrowUpRight size={17} /></div><div><span className="landingPreviewIcon">✓</span><span><strong>Checks</strong></span><ArrowUpRight size={17} /></div></div>
      </div>
    </div>
    <div className="landingPreviewFoot"><span><span className="landingStatusDot" /> Illustrative preview</span><span>No account data</span></div>
  </div>;
}

export default function MarketingPage() {
  return <div className="landingPage">
    <GrowthTracker eventName="landing_viewed" contentId="landing-global-waitlist-v1" />
    <header className="landingHeader"><Brand /><nav aria-label="Main navigation"><a href="#product">Product</a><a href="#up-next">Up next</a><a href="#faq">FAQ</a><a href={docs}>Docs</a></nav><details className="landingMobileNav"><summary>Menu <ChevronDown size={14} aria-hidden="true" /></summary><nav aria-label="Mobile navigation"><a href="#product">Product</a><a href="#up-next">Up next</a><a href="#faq">FAQ</a><a href={docs}>Docs</a></nav></details><div className="landingHeaderActions"><ThemeToggle /><Link href="/app" className="landingSignIn">Sign in</Link><Link href="/waitlist" className="button dark">Join waitlist</Link></div></header>
    <main>
      <section className="landingHero"><div className="landingHeroCopy"><p className="landingKicker"><span className="landingStatusDot" /> PRIVATE BETA WAITLIST</p><h1>Know what you hold.</h1><p>See supported assets and wallet activity in one place.</p><div className="landingHeroActions"><Link href="/waitlist" className="button dark large">Join waitlist <ArrowRight size={16} /></Link><a href="#product">See the product <ArrowRight size={15} /></a></div><small>Join with email. Invites depend on eligibility and availability.</small></div><Preview /></section>
      <section className="landingSection" id="product"><div className="landingSectionHead"><p className="landingKicker">THE PRODUCT</p><h2>What you can do</h2></div><div className="landingFeatureGrid"><article><span className="landingFeatureIcon"><Wallet size={20} /></span><h3>See your assets</h3><p>Connect a supported wallet to see selected Base assets and activity.</p><a href={`${docs}/product/wallets-and-assets/`}>Wallets and assets <ArrowUpRight size={15} /></a></article><article><span className="landingFeatureIcon"><ShieldCheck size={20} /></span><h3>Check before you sign</h3><p>Review supported transfers and safety checks before approving in your wallet.</p><a href={`${docs}/product/transaction-lifecycle/`}>How transactions work <ArrowUpRight size={15} /></a></article></div></section>
      <section className="landingSection landingFuture" id="up-next"><div className="landingSectionHead"><p className="landingKicker">UP NEXT</p><h2>More is planned.</h2><p>Rewards and membership benefits are not live. See the <a href={`${docs}/getting-started/status/`}>product status</a> for what’s available now.</p></div></section>
      <section className="landingSection landingFaq" id="faq"><div className="landingSectionHead"><h2>Questions</h2></div><div className="landingFaqList">{faqs.map(({ question, answer }) => <details key={question}><summary>{question}<ChevronDown size={18} aria-hidden="true" /></summary><p>{answer}</p></details>)}</div></section>
      <section className="landingClose"><h2>Want to hear when access opens?</h2><Link href="/waitlist" className="button dark large">Join waitlist <ArrowRight size={16} /></Link></section>
    </main>
    <footer className="landingFooter"><div className="landingFooterTop"><div className="landingFooterBrand"><Brand /><small>Private beta. Availability varies.</small></div><div className="landingFooterLinks"><div><h2>Product</h2><a href="#product">Features</a><Link href="/waitlist">Join waitlist</Link><Link href="/app">Sign in</Link></div><div><h2>Resources</h2><a href={docs}>Docs home</a><a href={`${docs}/getting-started/status/`}>Product status</a><a href={`${docs}/getting-started/setup/`}>Getting started</a></div><div><h2>Safety</h2><a href={`${docs}/safety/security-model/`}>Security model</a><a href={`${docs}/safety/account-controls/`}>Account controls</a><a href={`${docs}/safety/report-a-security-issue/`}>Report an issue</a></div><div><h2>Legal</h2><a href={`${docs}/legal/privacy-notice/`}>Privacy</a><a href={`${docs}/legal/terms-of-use/`}>Terms</a><a href={`${docs}/legal/risk-disclosure/`}>Risk disclosure</a><a href={`${docs}/legal/complaints/`}>Complaints</a></div></div></div><div className="landingFooterBottom"><span>© {new Date().getFullYear()} Aurel</span><ThemeToggle /></div></footer>
  </div>;
}
