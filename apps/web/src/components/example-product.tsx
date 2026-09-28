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
    { label: "Morpho", value: "USDC vaults", note: "Steakhouse and Gauntlet curate them on Base" }
  ] },
  cards: { title: "Cards", items: [
    { label: "Card", value: "Virtual Visa", note: "Issued by Stripe with Bridge once you're approved" },
    { label: "Controls", value: "Freeze · daily limit", note: "Spends your USDC on Base, up to the allowance you set" },
    { label: "Wallets", value: "Apple Pay · Google Pay", note: "When Stripe makes them available" }
  ] },
  transactions: { title: "Transactions", items: [
    { label: "Sent", value: "250 USDC", note: "Example network transaction" },
    { label: "Swap", value: "100 USDC → ETH", note: "Example route" },
    { label: "Received", value: "500 USDC", note: "Example deposit from an exchange" }
  ] },
  insights: { title: "Insights", items: [
    { label: "Money in", value: "$1,500", note: "Example month of deposits" },
    { label: "Money out", value: "$1,245", note: "Example month of sends" },
    { label: "Put to work", value: "$1,000", note: "Example Earn deposits" }
  ] },
  settings: { title: "Settings", items: [
    { label: "Account", value: "Sign-in and passkeys", note: "Review current session and recovery" },
    { label: "Protection", value: "Limits and privacy", note: "Wallet export and security controls" },
    { label: "Preferences", value: "Theme and notices", note: "Statements depend on provider" }
  ] },
  support: { title: "Support", items: [
    { label: "Chat", value: "Assistant and team", note: "Sign in to chat about your account" },
    { label: "Report a problem", value: "Tell us", note: "If someone else may be using your account, lock it in Settings first" },
    { label: "Help articles", value: "Browse now", note: "Getting started, safety, and availability" }
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
