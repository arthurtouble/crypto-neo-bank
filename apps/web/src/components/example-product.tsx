import Link from "next/link";
import { customerSections, type CustomerSection } from "@/lib/product-map";

type Example = { title: string; items: Array<{ label: string; value: string; note: string }> };

const examples: Record<CustomerSection | "overview", Example> = {
  overview: { title: "Overview", items: [
    { label: "Cash", value: "$8,420", note: "USDC and other stablecoins" },
    { label: "Vaults", value: "$2,650", note: "Aave position" },
    { label: "Portfolio", value: "$14,380", note: "Illustrative total" }
  ] },
  deposit: { title: "Deposit", items: [
    { label: "Crypto", value: "Receive USDC", note: "Your verified wallet address appears after sign-in" },
    { label: "Bank transfer", value: "Bridge required", note: "Account details appear when a bank provider is connected" },
    { label: "Aura tag", value: "@yourtag", note: "Share your public payment page" }
  ] },
  send: { title: "Send", items: [
    { label: "Crypto address", value: "To a wallet", note: "Review the network and destination" },
    { label: "Aura tag or contact", value: "To a person", note: "Resolve the current verified destination" },
    { label: "Bank", value: "Bridge required", note: "Saved recipients and provider checks apply" }
  ] },
  swap: { title: "Swap", items: [
    { label: "From", value: "USDC", note: "Base" },
    { label: "To", value: "ETH", note: "Another supported network" },
    { label: "Route", value: "LI.FI", note: "A current quote is required before review" }
  ] },
  earn: { title: "Earn", items: [
    { label: "Aave", value: "USDC", note: "Variable rate, protocol risk" },
    { label: "Sky", value: "USDC savings", note: "Ethereum USDC converts to sUSDS" },
    { label: "Morpho", value: "Unavailable", note: "Integration review needed" }
  ] },
  borrow: { title: "Borrow", items: [
    { label: "Debt", value: "$1,250", note: "Aave example position" },
    { label: "Repayment", value: "$1,250 + interest", note: "Current debt is read from Aave" },
    { label: "Health factor", value: "2.4", note: "Liquidation risk changes with markets" }
  ] },
  invest: { title: "Invest", items: [
    { label: "Crypto", value: "Supported swaps", note: "Live route and asset checks required" },
    { label: "Tokenized stocks", value: "Unavailable", note: "Eligibility and venue required" },
    { label: "Metals", value: "Unavailable", note: "Issuer and order provider required" }
  ] },
  cards: { title: "Cards", items: [
    { label: "Card", value: "Not issued", note: "Bridge or Rain issuer connection required" },
    { label: "Controls", value: "Freeze · limits · PIN", note: "Issuer-supported controls only" },
    { label: "Wallets", value: "Provisioning", note: "Available after issuer setup" }
  ] },
  rewards: { title: "Rewards", items: [
    { label: "Cashback", value: "Unavailable", note: "A funded rewards provider is required" },
    { label: "Benefits", value: "Coming later", note: "Eligibility and terms vary" },
    { label: "Earned rewards", value: "—", note: "Provider-confirmed only" }
  ] },
  transactions: { title: "Transactions", items: [
    { label: "Sent", value: "250 USDC", note: "Example network transaction" },
    { label: "Swap", value: "100 USDC → ETH", note: "Example route" },
    { label: "Card dispute", value: "Issuer required", note: "Contact support; issuer submission is not connected" }
  ] },
  insights: { title: "Insights", items: [
    { label: "Spending", value: "$1,245", note: "Example monthly spending" },
    { label: "Investments", value: "$5,960", note: "Example holdings" },
    { label: "Coverage", value: "Complete", note: "Real gaps are shown, never filled in" }
  ] },
  settings: { title: "Settings", items: [
    { label: "Account", value: "Sign-in and passkeys", note: "Review current session and recovery" },
    { label: "Protection", value: "Limits and privacy", note: "Wallet export and security controls" },
    { label: "Preferences", value: "Theme and notices", note: "Statements depend on provider" }
  ] },
  support: { title: "Support", items: [
    { label: "Assistant", value: "Product help", note: "Ask about features and account controls" },
    { label: "Contact", value: "Open a case", note: "Sign in for account-specific support" },
    { label: "Docs and FAQs", value: "Browse now", note: "Read about availability and safety" }
  ] }
};

export function ExampleProduct({ section, onSignIn, signInReady = true }: { section: string; onSignIn: () => void; signInReady?: boolean }) {
  const key = customerSections.includes(section as CustomerSection) ? section as CustomerSection : "overview";
  const example = examples[key];
  return <div className="exampleProduct">
    <div className="exampleBanner"><strong>Example data</strong><span>Explore Aura before creating an account. Values and activity shown here are fictional.</span></div>
    <section className="pageIntro compact"><div><h1>{example.title}</h1></div></section>
    <div className="exampleGrid">{example.items.map((item) => <article className="panel exampleCard" key={item.label}>
      <span className="exampleLabel">Example data · {item.label}</span><strong>{item.value}</strong><p>{item.note}</p>
    </article>)}</div>
    <div className="exampleNext"><button className="button primary" onClick={onSignIn} disabled={!signInReady}>Sign in to continue</button><Link href="/">About Aura</Link></div>
  </div>;
}
