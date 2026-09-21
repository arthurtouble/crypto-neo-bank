import Link from "next/link";
import { ArrowLeft, BookOpen, CheckCircle2, ExternalLink, LockKeyhole, Scale, ShieldAlert, WalletCards } from "lucide-react";
import { Brand } from "@/components/brand";
import { ThemeToggle } from "@/components/theme-toggle";

const providerRows = [
  ["Aurel", "Interface, policy review, disclosures, provider orchestration, projections, support tooling", "Cannot sign a customer wallet; projections are not an asset ledger"],
  ["Privy", "Authentication, embedded wallet infrastructure, recovery/export UI, transaction confirmation", "Does not make an asset or protocol safe and is not the cross-chain route"],
  ["Base / EVM chains", "Canonical balances, contract state, transaction ordering and settlement", "Transactions are irreversible; chain availability and fees vary"],
  ["Aave V3", "Permissionless supply, withdrawal, collateral, borrow and repayment contracts", "Variable rates, liquidation, oracle, governance and smart-contract risk"],
  ["LI.FI route", "Live route discovery and prepared source-chain transaction", "The selected bridge/DEX contracts settle; route quotes expire and destination finality varies"],
  ["Bridge / Rain / issuer", "Future regulated identity, fiat, conversion and card program services", "Not contracted or active in this deployment"]
];

const navigation = [
  ["overview", "Overview"], ["custody", "Custody & authority"], ["providers", "Provider map"], ["networks", "Networks & assets"],
  ["transactions", "Transaction lifecycle"], ["defi", "Earn & borrow"], ["routing", "Cross-chain"], ["markets", "Tokenized markets"],
  ["regulated", "Fiat & cards"], ["data", "Data & privacy"], ["security", "Security"], ["fees", "Fees"], ["status", "Product status"]
];

function Status({ state }: { state: "live" | "prepared" | "unavailable" }) {
  return <span className={`docsStatus ${state}`}>{state}</span>;
}

export default function DocsPage() {
  return <div className="docsPage"><header className="docsHeader"><Brand compact /><div className="docsHeaderActions"><ThemeToggle /><Link href="/app"><ArrowLeft size={15} /> Back to product</Link></div></header><main className="docsMain"><aside><p className="eyebrow">TRUST CENTER</p><nav>{navigation.map(([id, label], index) => <a className={index === 0 ? "active" : ""} href={`#${id}`} key={id}>{label}</a>)}</nav></aside><article>
    <p className="eyebrow">VERSION 1.0 · EFFECTIVE 21 SEPTEMBER 2026</p><h1 id="overview">Understand the system<br />before you trust it.</h1><p className="docsLead">Aurel is a customer-controlled interface across wallet infrastructure, public blockchains, and selected protocols. A unified experience does not make those systems legally, operationally, or economically identical.</p>
    <div className="docsNotice"><BookOpen size={18} /><p><strong>Current release boundary</strong>Wallet, Base asset, Aave, routing, policy, membership, and documentation features are implemented. Banking, identity verification, cards, insurance, travel vendors, and tokenized securities remain unavailable until the relevant provider, legal, and operational gates are complete.</p></div>

    <h2 id="custody">Custody and transaction authority</h2><p>Customer wallets are provisioned through Privy and configured for visible customer confirmation. Aurel prepares transactions and evaluates product policies; it does not possess a private key capable of unilaterally signing a transfer. Recovery and wallet export use Privy’s customer-facing controls.</p><div className="docsCallouts"><div><WalletCards size={18} /><strong>Source of truth</strong><span>Balances and settlement come from chain contracts and provider records.</span></div><div><LockKeyhole size={18} /><strong>Every write is explicit</strong><span>The wallet confirmation shows the final transaction before signing.</span></div><div><ShieldAlert size={18} /><strong>Noncustodial is not risk-free</strong><span>Key compromise, malicious approvals, protocol failure, and irreversible transfers remain possible.</span></div></div>

    <h2 id="providers">Provider responsibility map</h2><div className="docsTable"><div className="docsTableHead"><span>System</span><span>Role</span><span>Does not mean</span></div>{providerRows.map(([name, role, limit]) => <div key={name}><strong>{name}</strong><span>{role}</span><span>{limit}</span></div>)}</div>

    <h2 id="networks">Supported networks and assets</h2><p>Base mainnet is the home network. USDC routing is allowlisted across Base, Ethereum, Arbitrum, Optimism, and Polygon. The Base asset view reads native ETH, native USDC, and WETH. Token contract addresses are fixed in code and route responses are validated against the requested network and token.</p><div className="docsWarning">Sending an unsupported asset or using an incompatible network can cause permanent loss. “Supported” means the interface knows the network and asset—not that a bridge or transaction will always be available.</div>

    <h2 id="transactions">Transaction lifecycle</h2><ol className="docsSteps"><li><strong>Prepare</strong><span>A provider or protocol returns an unsigned transaction plan.</span></li><li><strong>Validate</strong><span>Aurel checks chain, asset, destination, amount, disclosures, and configured controls.</span></li><li><strong>Simulate</strong><span>Where supported, expected position changes and warnings are shown before signing.</span></li><li><strong>Confirm</strong><span>Privy presents the transaction; the customer accepts or cancels.</span></li><li><strong>Observe</strong><span>Aurel records the intent and transaction hash. Chain/provider state determines settlement.</span></li></ol>

    <h2 id="defi">Earn and borrowing</h2><p>Aurel’s initial DeFi integration is the governed Aave V3 market on Base. Market rates and positions are read from Aave’s interface to protocol data; action plans are prepared by Aave and signed by the customer. Rates are variable. Borrowers can be liquidated automatically if their health factor falls below the protocol boundary. Aurel cannot pause liquidation or restore funds.</p><p>Displayed APY is not guaranteed interest, a deposit rate, or insured return. Supply positions carry contract, governance, oracle, liquidity, stablecoin, and chain risk.</p>

    <h2 id="routing">Cross-chain routing</h2><p>LI.FI supplies live USDC route quotes. When ERC-20 approval is required, Aurel requests an exact-amount approval and waits for its source-chain confirmation before presenting the route transaction. A source transaction hash does not guarantee destination receipt. Routes add bridge, DEX, liquidity, relayer, finality, and destination-contract dependencies.</p>

    <h2 id="markets">Tokenized markets</h2><p>Tokenized securities and real-world-asset products are disabled. A token address or DeFi pool does not by itself establish lawful distribution. Each future product must record its issuer, legal rights, approved venue, eligible jurisdictions, identity standard, offering documents, transfer restrictions, liquidity, custody model, pricing source, and current review date. Eligibility fails closed.</p>

    <h2 id="regulated">Fiat, identity, cards, and benefits</h2><p>No bank account, card, fiat transfer, conversion, insurance, airport lounge, eSIM, or lifestyle vendor is active. These require commercial contracts and, where applicable, regulated onboarding, sanctions screening, fraud controls, safeguarding, disputes, complaints, and jurisdictional approval. The card screen intentionally contains no card number or claim of issuance.</p>

    <h2 id="data">Data architecture and privacy</h2><p>Aurel stores rebuildable operational projections: authenticated subject references, public wallet addresses, transaction intents, policy results, provider-event receipts, membership projections, and operational audit records. It is not the authoritative balance ledger. The design avoids storing KYC documents; a regulated provider would remain authoritative for its onboarding record.</p><p>If Aurel’s projection database were lost, balances and positions can be re-read from the chain and providers. Some Aurel-specific history—such as past policy intent evidence—would still require backups and retention controls in production.</p>

    <h2 id="security">Security model</h2><ul className="docsBullets"><li><CheckCircle2 size={14} /> Privy access tokens are verified server-side for protected APIs.</li><li><CheckCircle2 size={14} /> Operations APIs use a separate explicit subject allowlist and deny everyone by default.</li><li><CheckCircle2 size={14} /> Transaction plans are chain-bound; supported assets and networks are allowlisted.</li><li><CheckCircle2 size={14} /> Provider events are signature-checked, idempotently received, queued, retried, and reconciled.</li><li><CheckCircle2 size={14} /> The AI concierge is read-only and has no signing or transaction tool.</li></ul><p>Customers should use MFA or a passkey, verify destinations and contract prompts, avoid sharing recovery material, and independently confirm high-value actions.</p>

    <h2 id="fees">Fees and conflicts</h2><p>Aurel currently charges no product fee. Network gas, protocol interest, bridge/DEX costs, price impact, and provider costs may still apply and should appear in the relevant quote or protocol state. No LI.FI integrator fee is configured in this release. Before any Aurel fee, spread, interchange share, referral revenue, or benefit subscription becomes active, it must be separately disclosed in-product.</p><p>Aurel has no house token. Protocol and product inclusion should be based on customer utility, risk, liquidity, operational reliability, and documented review—not on creating demand for a proprietary asset.</p>

    <h2 id="status">Feature status</h2><div className="statusMatrix"><div><Status state="live" /><span>Privy authentication and customer-controlled EVM wallet</span></div><div><Status state="live" /><span>Base ETH, USDC, WETH reads; Base sends</span></div><div><Status state="live" /><span>Aave market data and user-signed Earn/Borrow plans</span></div><div><Status state="live" /><span>Live LI.FI USDC route preparation and signing</span></div><div><Status state="prepared" /><span>Membership and vendor-neutral benefits entitlements</span></div><div><Status state="prepared" /><span>Tokenized-market listing and eligibility controls</span></div><div><Status state="unavailable" /><span>Banking, KYC, fiat rails, card issuance, insurance, and travel vendors</span></div></div>
    <div className="docsSource"><Scale size={18} /><p><strong>Important</strong>This documentation explains the implemented product architecture and limitations. It is not legal, tax, accounting, or investment advice. Protocols and providers can change independently of Aurel.</p><a href="https://basescan.org" target="_blank" rel="noreferrer">BaseScan <ExternalLink size={12} /></a></div>
  </article></main></div>;
}
