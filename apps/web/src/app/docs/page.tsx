import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  BookOpen,
  LockKeyhole,
  Scale,
  ShieldCheck,
  WalletCards
} from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const docs = [
  { icon: WalletCards, title: "How custody works", text: "The default wallet is designed so neither Aurel nor Privy can unilaterally move customer assets." },
  { icon: ShieldCheck, title: "Our safety methodology", text: "How we evaluate protocol, issuer, chain, liquidity, and concentration exposure." },
  { icon: Scale, title: "Provider responsibilities", text: "A plain-language map of what Aurel, Privy, issuers, and protocols each provide." },
  { icon: LockKeyhole, title: "Account recovery", text: "Recovery, passkeys, devices, approval policies, and the controls that protect withdrawals." }
];

export default function DocsPage() {
  return (
    <div className="docsPage">
      <header className="docsHeader">
        <Brand compact />
        <div className="docsHeaderActions">
          <ThemeToggle />
          <Link href="/app"><ArrowLeft size={15} /> Back to product</Link>
        </div>
      </header>

      <main className="docsMain">
        <aside>
          <p className="eyebrow">DOCUMENTATION</p>
          <nav>
            <a className="active" href="#overview">Overview</a>
            <a href="#principles">Principles</a>
            <a href="#custody">Custody</a>
            <a href="#providers">Providers</a>
            <a href="#risk">Risk methodology</a>
            <a href="#status">Product status</a>
          </nav>
        </aside>

        <article>
          <p className="eyebrow">TRUST CENTER · VERSION 0.1</p>
          <h1 id="overview">Understand the system<br />before you trust it.</h1>
          <p className="docsLead">Aurel is being designed as a transparent interface across self-custodial wallets, regulated payment providers, and selected onchain protocols. Those components are connected in the experience, but they are not legally or economically identical.</p>
          <div className="docsNotice">
            <BookOpen size={18} />
            <p><strong>Demonstration status</strong>This deployed prototype does not offer a live bank account, card, investment product, or custody service. Provider-gated surfaces remain simulations until production approval.</p>
          </div>

          <h2 id="principles">Operating principles</h2>
          <p>We do not issue a house token or require customers to participate in a proprietary ecosystem. Product inclusion should be based on customer utility, liquidity, operational reliability, and a documented risk review.</p>

          <div className="docsCards">
            {docs.map(({ icon: Icon, title, text }) => (
              <section key={title}>
                <Icon size={20} />
                <h3>{title}</h3>
                <p>{text}</p>
                <span>Full article planned <ArrowRight size={14} /></span>
              </section>
            ))}
          </div>

          <h2 id="providers">Provider map</h2>
          <div className="providerMap">
            <div><strong>Privy</strong><span>Authentication, embedded wallets, signing, policies, and onchain execution.</span></div>
            <div><strong>Bridge</strong><span>Planned KYC/KYB, fiat rails, conversion, virtual accounts, and cards—subject to approval.</span></div>
            <div><strong>Aurel</strong><span>Product experience, risk presentation, portfolio normalization, policies, support, and reconciliation.</span></div>
          </div>

          <h2 id="status">Current product status</h2>
          <p>The first development milestone is a Privy-enabled sandbox product. Bridge and card functionality will remain simulated until the program and production use case are approved.</p>
        </article>
      </main>
    </div>
  );
}
