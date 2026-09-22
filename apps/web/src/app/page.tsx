import Link from "next/link";
import { BadgeCheck, CircleDollarSign, Globe2, KeyRound, Landmark, Layers3, LockKeyhole, Route, ShieldCheck, WalletCards } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const docsUrl = "https://aurel-docs.aurel-events.workers.dev";

export default function MarketingPage() {
  return (
    <div className="marketingPage">
      <header className="marketingHeader">
        <Brand />
        <nav aria-label="Main navigation"><a href="#principles">Why Aurel</a><a href="#product">What you can do</a><a href={docsUrl}>Help</a></nav>
        <div className="marketingActions"><ThemeToggle /><Link className="button dark" href="/app">Open Aurel</Link></div>
      </header>
      <main>
        <section className="marketingHero">
          <div className="heroCopy">
            <p className="eyebrow"><WalletCards size={14} /> Private digital wealth</p>
            <h1>Your money,<br /><em>all in one place.</em></h1>
            <p>Save, spend, invest, and move money from one secure account.</p>
            <div className="heroButtons"><Link className="button dark large" href="/app">Open Aurel</Link><a className="button textButton" href={`${docsUrl}/getting-started/setup/`}>How Aurel works</a></div>
            <div className="trustLine"><span><KeyRound size={15} /> You sign every transaction</span><span><LockKeyhole size={15} /> No Aurel token</span><span><Globe2 size={15} /> Built for global assets</span></div>
          </div>
          <div className="heroVisual">
            <div className="visualHalo" />
            <div className="statementCard"><div className="statementHead"><span>AUREL / PRIVATE</span><span>ILLUSTRATIVE VIEW</span></div><p>TOTAL ASSETS</p><strong>$184,290.42</strong><div className="statementRule" /><div className="statementRows"><span><i className="dot greenDot" />Earning stablecoins <b>61.2%</b></span><span><i className="dot brassDot" />Connected assets <b>23.4%</b></span><span><i className="dot blueDot" />Ready to use <b>15.4%</b></span></div><div className="statementFoot"><span>ESTIMATED YIELD<br /><b>4.72%</b></span><span>AVAILABLE<br /><b>$28,450</b></span></div></div>
            <div className="floatingNote safetyNote"><ShieldCheck size={17} /><span><small>SAFETY CHECK</small><strong>Ready</strong></span></div>
            <div className="floatingNote policyNote"><CircleDollarSign size={17} /><span><small>CASH RESERVE</small><strong>Keep $10K available</strong></span></div>
          </div>
        </section>

        <section className="principlesSection" id="principles">
          <p className="eyebrow"><BadgeCheck size={14} /> Why Aurel</p>
          <div className="principlesIntro"><h2>Independent by design.<br />Clear by default.</h2><p>Aurel has no house token and no reason to steer you into one ecosystem. Every choice starts with your needs.</p></div>
          <div className="principleGrid">
            <article><span className="principleIcon"><KeyRound size={20} /></span><h3>You keep control</h3><p>See who holds each asset, what you are approving, and how to leave.</p></article>
            <article><span className="principleIcon"><ShieldCheck size={20} /></span><h3>Risk stays visible</h3><p>Fees, liquidity, dependencies, and ways to lose money appear before you act.</p></article>
            <article><span className="principleIcon"><Layers3 size={20} /></span><h3>One simple view</h3><p>Bring wallets, stablecoins, DeFi, and future everyday finance into one place.</p></article>
          </div>
        </section>

        <section className="productSection" id="product">
          <div className="sectionCopy"><p className="eyebrow"><Route size={14} /> One Account</p><h2>Money without the machinery.</h2><p>A clear view of your money, with every action reviewed before it happens.</p><ul><li><WalletCards size={16} /> See everything in one place</li><li><Route size={16} /> Send and receive digital dollars</li><li><CircleDollarSign size={16} /> Access selected markets</li><li><Landmark size={16} /> Set up bank transfers and cards</li></ul></div>
          <div className="productTiles"><article className="productTile mainTile"><span><WalletCards size={20} /></span><p className="eyebrow">Illustrative holdings</p><h3>Everything you own,<br />clear at a glance.</h3><div className="miniAssets"><span><i>U</i> USD Coin <b>$141,290</b></span><span><i>E</i> Ether <b>$34,546</b></span><span><i>W</i> Wrapped Ether <b>$8,454</b></span></div></article><article className="productTile quoteTile"><ShieldCheck size={24} /><blockquote>Know what happens before you sign.</blockquote><p>Aurel shows the control, cost, and risk behind each action.</p></article></div>
        </section>
      </main>
      <footer className="marketingFooter">
        <div className="footerLead"><Brand compact /><p>Independent by design. No house token.</p><small>Availability depends on account eligibility, location, and service activation.</small></div>
        <div className="footerColumns">
          <section><h2>Product</h2><Link href="/app">Overview</Link><Link href="/app/assets">Assets</Link><Link href="/app/earn">Earn</Link><Link href="/app/borrow">Borrow</Link><Link href="/app/benefits">Benefits</Link></section>
          <section><h2>Learn</h2><a href={docsUrl}>Documentation</a><a href={`${docsUrl}/getting-started/setup/`}>Get started</a><a href={`${docsUrl}/getting-started/status/`}>Product status</a><a href={`${docsUrl}/company/fees-and-alignment/`}>Fees and alignment</a></section>
          <section><h2>Safety</h2><Link href="/app/security">Safety center</Link><a href={`${docsUrl}/safety/security-model/`}>Security model</a><a href={`${docsUrl}/safety/account-controls/`}>Account controls</a><a href={`${docsUrl}/safety/report-a-security-issue/`}>Report an issue</a></section>
          <section><h2>Legal</h2><a href={`${docsUrl}/legal/terms-of-use/`}>Terms</a><a href={`${docsUrl}/legal/privacy-notice/`}>Privacy</a><a href={`${docsUrl}/legal/risk-disclosure/`}>Risk disclosure</a><a href={`${docsUrl}/legal/acceptable-use/`}>Acceptable use</a><a href={`${docsUrl}/legal/complaints/`}>Complaints</a></section>
        </div>
        <div className="footerBottom"><span>© 2026 Aurel</span><span>Pre-launch product</span><div className="footerTheme"><ThemeToggle /> <span>Theme</span></div></div>
      </footer>
    </div>
  );
}
