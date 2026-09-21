import Link from "next/link";
import { Activity, ArrowLeft, BookOpen, CheckCircle2, Database, ExternalLink, Fingerprint, KeyRound, LifeBuoy, LockKeyhole, Scale, ShieldCheck, WalletCards } from "lucide-react";
import { Brand } from "@/components/brand";
import { DocsNavigation } from "@/components/docs-navigation";
import { ThemeToggle } from "@/components/theme-toggle";

const navigation = [
  ["overview", "Overview"], ["architecture", "Architecture"], ["custody", "Custody & access"],
  ["security", "Security controls"], ["transactions", "Transactions"], ["states", "States & recovery"],
  ["networks", "Networks & assets"], ["routing", "Cross-chain"], ["defi", "Earn & borrow"],
  ["markets", "Tokenized markets"], ["membership", "Membership"], ["support", "Concierge & support"],
  ["data", "Data & privacy"], ["events", "Provider events"], ["operations", "Operations"],
  ["fees", "Fees & alignment"], ["regulated", "Regulated services"], ["status", "Product status"]
] as const;

const providerRows = [
  ["Aurel", "Interface, policy evaluation, disclosures, provider orchestration, projections and support tooling.", "Cannot unilaterally sign a customer wallet. Projections are not an asset ledger."],
  ["Privy", "Authentication, embedded-wallet infrastructure, recovery and export controls, and customer transaction confirmation.", "Does not make an asset or protocol safe and does not settle cross-chain routes."],
  ["Base / EVM", "Canonical balances, contract state, transaction ordering, receipts and settlement.", "Transactions are irreversible. Availability, fees and finality vary by chain."],
  ["Aave V3", "Permissionless supply, withdrawal, collateral, borrowing and repayment contracts on Base.", "Rates are not guaranteed. Liquidation, oracle, governance and contract risks remain."],
  ["LI.FI", "Live route discovery and prepared source-chain approval and route transactions.", "Underlying bridge and exchange contracts settle the route. Quotes expire and destination delivery can fail."],
  ["Bridge / Rain / issuer", "Potential future identity, fiat, conversion, card and regulated-product services.", "No such provider is contracted or active in this deployment."]
];

const controlRows = [
  ["Emergency account lock", "Off", "When enabled, blocks every new transaction intent prepared through Aurel."],
  ["Saved destinations only", "Off", "Optional allowlist mode. Direct transfers can be restricted to cooled address-book entries."],
  ["New-address cooling", "24 hours", "Transfers of $1,000 or more to a newly saved destination wait until its cooling period ends."],
  ["Rolling transaction limit", "$25,000 / 24 h", "Compares the new action with submitted and confirmed estimated USD volume in the prior 24 hours."],
  ["Step-up threshold", "$10,000", "Requires passkey enrollment before the product will prepare a higher-risk action."],
  ["High-value review", "$25,000 / 24 h", "Places the intent in cooling, then requires a fresh preparation with the same instruction fingerprint."],
  ["Reviewed-intent expiry", "15 minutes", "A released intent must be submitted promptly; otherwise a new review is required."],
  ["Reserve-floor warning", "$10,000", "Warns when an action may reduce the visible liquid reserve below the configured floor; it is not a hard block."]
];

const stateRows = [
  ["blocked", "A policy rule rejected the request. A reason is retained; no signing request is created."],
  ["cooling", "A high-value or new-destination hold is active. The action cannot be submitted yet."],
  ["reviewed", "The cooling window elapsed and the original instruction fingerprint was revalidated. Valid for 15 minutes."],
  ["submitted", "The customer signed and a transaction hash exists. Settlement is still pending."],
  ["confirmed", "The source-chain receipt reports successful execution."],
  ["failed", "Preparation, submission or the source-chain receipt failed."],
  ["cancelled", "The instruction was cancelled before settlement."]
];

const statusRows: Array<["live" | "prepared" | "unavailable", string, string]> = [
  ["live", "Authentication and wallets", "Privy login, embedded or external EVM wallet, recovery/export path and customer confirmation."],
  ["live", "Base money movement", "ETH, native USDC and WETH reads; direct Base transfers with policy evaluation and simulation."],
  ["live", "Aave V3", "Base market and position reads plus customer-signed Earn and Borrow plans."],
  ["live", "Cross-chain USDC", "LI.FI quotes and exact-approval route preparation across five allowlisted EVM networks."],
  ["live", "Security and evidence", "Account lock, address book, cooling, limits, step-up, intent history, provider-event intake, dead-letter escalation and scheduled reconciliation."],
  ["live", "Support and product analytics", "Authenticated cases, abuse limits, funnel events and read-only concierge."],
  ["prepared", "Membership and benefits", "Tier projection and vendor-neutral entitlement model; no third-party benefit fulfilment."],
  ["prepared", "Turnstile bot defence", "Client and server verification paths exist; enforcement begins only after site and secret keys are configured."],
  ["prepared", "Tokenized-market controls", "Issuer, venue, document, jurisdiction and transfer-rule review model exists; access remains fail-closed."],
  ["unavailable", "Regulated services", "Bank accounts, KYC, fiat rails, conversion, cards, insurance and travel benefits."],
  ["unavailable", "Edge launch controls", "Custom domain, WAF rules, API Shield, operations Access policy and external log export await production configuration."]
];

function Status({ state }: { state: "live" | "prepared" | "unavailable" }) {
  return <span className={`docsStatus ${state}`}>{state}</span>;
}

function DocsTable({ columns, rows, className = "" }: { columns: string[]; rows: string[][]; className?: string }) {
  return <div className={`docsTable ${className}`} style={{ "--docs-columns": `repeat(${columns.length}, minmax(0, 1fr))` } as React.CSSProperties}>
    <div className="docsTableHead">{columns.map((column) => <span key={column}>{column}</span>)}</div>
    {rows.map((row) => <div key={row[0]}>{row.map((cell, index) => index === 0 ? <strong key={cell}>{cell}</strong> : <span key={cell}>{cell}</span>)}</div>)}
  </div>;
}

export default function DocsPage() {
  return <div className="docsPage">
    <header className="docsHeader"><Brand compact /><div className="docsHeaderActions"><ThemeToggle /><Link href="/app"><ArrowLeft size={15} /> Back to product</Link></div></header>
    <main className="docsMain">
      <aside><p className="eyebrow">DOCUMENTATION</p><DocsNavigation entries={navigation.map(([id, label]) => ({ id, label }))} /></aside>
      <article>
        <p className="eyebrow">TRUST CENTER · VERSION 1.1 · 21 SEPTEMBER 2026</p>
        <h1 id="overview">Understand the system<br />before you trust it.</h1>
        <p className="docsLead">Aurel is a customer-controlled financial interface across wallet infrastructure, public blockchains and selected protocols. It brings those systems into one calm experience without pretending they have the same legal, operational or economic guarantees.</p>
        <div className="docsFacts"><div><span>Home network</span><strong>Base mainnet</strong></div><div><span>Asset authority</span><strong>Chains & providers</strong></div><div><span>Signing model</span><strong>Customer confirmed</strong></div><div><span>House token</span><strong>None</strong></div></div>
        <div className="docsNotice"><BookOpen size={18} /><p><strong>Read status labels literally</strong><b>Live</b> means implemented and available in this deployment. <b>Prepared</b> means product or code foundations exist but an external configuration, review or vendor is missing. <b>Unavailable</b> means customers cannot use the service. A screen or data model is never evidence that a regulated service is active.</p></div>

        <h2 id="architecture">System architecture and source of truth</h2>
        <p>Aurel is deliberately not the authoritative balance ledger. Financial state is read from public chains, protocol contracts and—when regulated products are introduced—the contracted provider’s records. Aurel stores a rebuildable projection for a faster interface and retained evidence needed to apply controls, investigate events and support customers.</p>
        <div className="docsArchitecture" aria-label="System authority flow"><div><WalletCards size={17} /><strong>Customer</strong><span>Authenticates, reviews and confirms</span></div><i>→</i><div><ShieldCheck size={17} /><strong>Aurel policy</strong><span>Prepares, checks and records</span></div><i>→</i><div><KeyRound size={17} /><strong>Privy wallet</strong><span>Presents the final signature</span></div><i>→</i><div><Database size={17} /><strong>Chain / provider</strong><span>Settles and remains authoritative</span></div></div>
        <p>Loss of Aurel’s projection database must not change ownership or canonical balances. It would still be an operational incident because policies, customer instructions, support records and transaction evidence are not disposable. Recovery restores retained evidence first, pauses new instructions where consistency is uncertain, and reconciles every affected wallet and provider event.</p>
        <h3>Provider responsibility map</h3><DocsTable columns={["System", "Responsibility", "Boundary"]} rows={providerRows} />

        <h2 id="custody">Custody, identity and access</h2>
        <p>Privy provides Aurel’s authentication and wallet infrastructure. A customer can use an embedded wallet or connect a supported external EVM wallet. Protected Aurel APIs verify the Privy access token server-side and derive the customer subject from that verified token rather than accepting an identity supplied by the browser.</p>
        <div className="docsCallouts"><div><WalletCards size={18} /><strong>No Aurel signing key</strong><span>Aurel has no private key or delegated signer that can independently move customer assets.</span></div><div><Fingerprint size={18} /><strong>Customer confirmation</strong><span>The wallet presents the prepared transaction. The customer accepts or rejects the final signing request.</span></div><div><LockKeyhole size={18} /><strong>Recovery and export</strong><span>Wallet recovery and export follow Privy’s customer-facing controls, not an Aurel administrator action.</span></div></div>
        <div className="docsWarning"><strong>Important boundary.</strong> Aurel controls apply only to instructions prepared through Aurel. If a customer exports a wallet, connects it to another application or signs a transaction outside Aurel, Aurel’s account lock, address book, limits and review periods cannot prevent that action.</div>

        <h2 id="security">Security controls</h2>
        <p>Security controls are layered. Authentication protects account access; product policy limits what Aurel will prepare; wallet confirmation controls signing; the chain or provider determines settlement. No single layer is presented as a guarantee against loss.</p>
        <DocsTable columns={["Control", "Default", "Enforcement"]} rows={controlRows} />
        <h3>Destination safety</h3><p>The address book accepts valid EVM addresses, records a human-readable label and applies a cooling timestamp. A customer can enable saved-destination-only mode. By default, a transfer of at least $1,000 to a new destination is blocked until the address is saved and its 24-hour cooling window ends; lower-value new destinations generate a warning. Adding, cooling and removing destinations creates an audit event.</p>
        <h3>Authentication and high-risk actions</h3><p>Passkey enrollment is required by the Aurel experience before higher-risk transaction preparation. Unknown USD values are treated as requiring step-up rather than silently bypassing the threshold. Privy’s confirmation remains the actual signing control. Customers should keep account recovery methods current and never share a seed phrase, private key, one-time code or recovery material with Aurel support.</p>
        <h3>Operational separation</h3><ul className="docsBullets"><li><CheckCircle2 size={14} /> Customer APIs require a verified Privy identity.</li><li><CheckCircle2 size={14} /> Operations APIs require a separate explicit Privy-subject allowlist; an empty list denies everyone.</li><li><CheckCircle2 size={14} /> Supported chains, assets and direct-transfer destinations are validated before a wallet prompt.</li><li><CheckCircle2 size={14} /> The concierge is read-only and has no transaction, signing or administrative tool.</li><li><CheckCircle2 size={14} /> Production secrets are bindings, not browser environment values or committed source.</li><li><CheckCircle2 size={14} /> CI checks lint, types, unit tests and production build before release.</li></ul>

        <h2 id="transactions">Transaction lifecycle</h2>
        <ol className="docsSteps"><li><strong>1 · Request</strong><span>The customer supplies the action, amount, network and destination or protocol position.</span></li><li><strong>2 · Prepare</strong><span>Aurel or the integrated protocol requests an unsigned transaction plan. No signature occurs at this stage.</span></li><li><strong>3 · Validate</strong><span>The server checks account lock, chain, asset, destination, cooling, rolling amount, review threshold, step-up and required disclosures.</span></li><li><strong>4 · Simulate</strong><span>Direct sends use RPC gas estimation and, for ERC-20 transfers, an execution call. Protocol previews show expected changes and explicit risk warnings.</span></li><li><strong>5 · Confirm</strong><span>Privy presents the final transaction. The customer signs or cancels. Submitted state requires a transaction hash.</span></li><li><strong>6 · Observe</strong><span>Aurel records the state transition and rechecks the source-chain receipt. Provider or chain state determines settlement.</span></li></ol>
        <p>The interface shows a $10,000 liquid-reserve warning where relevant. It is guidance, not a custodial hold. On-chain transactions can be reordered, delayed, reverted or priced differently from a preview.</p>

        <h2 id="states">Transaction states, evidence and recovery</h2>
        <p>Every tracked instruction has a constrained state. Invalid transitions are rejected. State changes append an event containing the previous state, next state, policy result and available transaction evidence; the history is not overwritten by the latest status.</p>
        <DocsTable columns={["State", "Meaning"]} rows={stateRows} />
        <div className="docsStateFlow"><code>blocked</code><span>or</span><code>cooling → reviewed → submitted → confirmed</code><span>with</span><code>failed / cancelled</code><span>as valid terminal outcomes</span></div>
        <h3>Receipt verification and exception handling</h3><p>Aurel rechecks submitted transactions against source-chain JSON-RPC endpoints on Base, Ethereum, Arbitrum, Optimism and Polygon. The stored record is updated with the receipt result, source block and last-check time. Activity refreshes trigger another check. A submitted transaction that remains unresolved for more than 15 minutes becomes an operations exception for investigation; that threshold does not imply failure or a settlement guarantee.</p>
        <p>For a data or event-processing incident, operations pauses affected instruction paths, restores retained evidence, replays idempotent provider events, compares provider and chain state, and records any gap as an incident. A canonical balance can be rebuilt; an unexplained evidence gap cannot be dismissed because the balance is still visible.</p>

        <h2 id="networks">Supported networks and assets</h2>
        <p>Base mainnet is the home network. The main asset view reads native ETH, native USDC and WETH on Base. Direct transfer preparation is currently Base-focused. Routed native USDC is allowlisted on Base, Ethereum, Arbitrum, Optimism and Polygon.</p>
        <DocsTable columns={["Network", "Chain ID", "Gas asset", "Current scope"]} rows={[["Base", "8453", "ETH", "Home network, asset view, direct sends, Aave and routed USDC"], ["Ethereum", "1", "ETH", "Routed native USDC"], ["Arbitrum", "42161", "ETH", "Routed native USDC"], ["Optimism", "10", "ETH", "Routed native USDC"], ["Polygon", "137", "POL", "Routed native USDC"]]} />
        <div className="docsWarning">“Supported” means Aurel knows the allowlisted chain and asset. It does not promise that a route, RPC endpoint or protocol is continuously available. Sending an unsupported token or using an incompatible network can cause permanent loss.</div>

        <h2 id="routing">Cross-chain routing</h2>
        <p>LI.FI supplies live USDC route quotes. Aurel validates the returned chain, asset and transaction plan against the request. When an ERC-20 approval is required, Aurel requests an exact-amount approval and waits for its source-chain receipt before presenting the route transaction. Unlimited approval is not the default route behavior.</p>
        <p>A route reference and source transaction hash are retained for support and reconciliation. Source-chain confirmation proves only that the source transaction executed. It does not guarantee destination delivery. Routes add bridge, exchange, liquidity, relayer, finality and destination-contract dependencies; quotes can expire before signing.</p>

        <h2 id="defi">Earn and borrowing</h2>
        <p>Aurel’s initial DeFi integration is the Aave V3 market on Base. Market rates and positions are read from Aave’s interface to protocol data. Supply, withdrawal, borrowing and repayment plans are prepared against Aave contracts and signed by the customer.</p>
        <div className="docsSplit"><section><strong>Earn</strong><p>Supplying an asset creates protocol exposure. Displayed APY is variable and is not a bank deposit rate, guaranteed interest or insured return. Withdrawals depend on available market liquidity.</p></section><section><strong>Borrow</strong><p>Collateral value, debt, rates and health factor can change. If health falls below Aave’s boundary, protocol liquidation can occur automatically. Aurel cannot pause or reverse it.</p></section></div>
        <p>Both paths carry contract, governance, oracle, liquidity, stablecoin and chain risks. A preview is decision support, not a guarantee or investment recommendation.</p>

        <h2 id="markets">Tokenized markets</h2><p>Tokenized securities and real-world-asset products are unavailable. A token contract or DeFi pool does not establish lawful distribution. Each future listing must record and pass review for issuer, legal rights, approved venue, eligible jurisdictions, identity standard, offering documents, transfer restrictions, liquidity, custody model, pricing source and review date.</p><p>Eligibility fails closed: if a required fact, document, jurisdiction rule or identity result is missing or stale, Aurel does not expose trading access. “On-chain” does not remove securities, sanctions, consumer-protection or distribution obligations.</p>

        <h2 id="membership">Membership and benefits</h2><p>Membership is designed as a balance-and-relationship ladder, not a proprietary token program. Until 30 days of eligible balance history exists, the interface can only show a projected tier based on currently visible eligible USDC. A projected tier is not a vested entitlement.</p><p>Benefit definitions are vendor-neutral and prepared for later fulfilment. Lounge access, insurance, eSIM, travel services, subscriptions, cashback or concierge fulfilment are not active merely because a tier or benefit appears in the product model. Each requires a contracted provider, eligibility terms, cost controls and support ownership.</p>

        <h2 id="support">Concierge and customer support</h2>
        <div className="docsCallouts docsCalloutsTwo"><div><LifeBuoy size={18} /><strong>Support cases</strong><span>Authenticated customers can create normal or urgent cases. Submission is limited to five cases per hour to reduce abuse.</span></div><div><Activity size={18} /><strong>Read-only concierge</strong><span>The concierge can explain the product and risks. It cannot sign, submit, change controls or provide individualized legal, tax or investment advice.</span></div></div>
        <p>Support will never request a seed phrase, private key, recovery secret or one-time authentication code. An urgent label routes an issue for faster review but does not provide emergency custody, transaction reversal or guaranteed recovery. Current service targets are operating objectives, not contractual service-level agreements.</p>

        <h2 id="data">Data architecture, privacy and retention</h2><p>Aurel minimizes authoritative financial data, not all data. The following categories have different recovery and retention needs.</p>
        <DocsTable columns={["Data category", "Authority", "Aurel treatment"]} rows={[["Balances and protocol positions", "Chain or provider", "Cached or projected for experience; rebuildable from the authoritative source."], ["Customer identity", "Verified Privy subject", "Stores the provider subject reference needed to protect customer records."], ["Wallet references", "Wallet / chain", "Stores public addresses and network context; never an Aurel private key."], ["Security preferences", "Customer instruction", "Retained because controls must survive sessions and be auditable."], ["Transaction intents and events", "Aurel evidence + chain receipt", "Retained with policy result, states, hashes and receipt checks for investigation."], ["KYC and regulated records", "Future regulated provider", "Designed to avoid storing identity documents; provider remains authoritative."], ["Support and consent", "Aurel", "Retained to resolve cases and demonstrate the disclosure or instruction shown."], ["Product analytics", "Aurel", "Authenticated, rate-limited allowlisted event names; never used as balance authority."], ["Provider webhook receipts", "Provider + Aurel intake", "Stored idempotently for retry, reconciliation and incident evidence."]]} />
        <p>Balance privacy is a local visual preference that obscures values in the interface. It does not hide public-chain activity. Aurel does not treat browser storage as durable transaction evidence. Production evidence requires controlled backups, restore testing and a defined retention schedule before broad launch.</p>

        <h2 id="events">Provider-event security</h2><p>External providers can report identity, payment, card or settlement changes asynchronously. Aurel’s provider-event intake verifies an HMAC-SHA-256 signature, rejects timestamps outside a five-minute tolerance and uses the provider event identifier to prevent replay. Accepted events enter a queue for asynchronous processing.</p>
        <ul className="docsBullets"><li><CheckCircle2 size={14} /> Duplicate event identifiers are idempotent and cannot create a second logical event.</li><li><CheckCircle2 size={14} /> Processing failures retry up to five times before dead-letter handling.</li><li><CheckCircle2 size={14} /> Dead-letter intake retains failure evidence and opens a critical operations issue instead of silently discarding an event.</li><li><CheckCircle2 size={14} /> A five-minute scheduled check identifies stale transactions, expired reviews and failed or stuck event processing.</li><li><CheckCircle2 size={14} /> Reconciliation compares queued work, provider state and Aurel evidence rather than assuming delivery.</li><li><CheckCircle2 size={14} /> Signing secrets remain server-side Cloudflare bindings.</li></ul>
        <p>These controls secure intake mechanics. A real provider launch also requires provider-specific payload schemas, key rotation, event ownership, reconciliation cadence and tested incident playbooks.</p>

        <h2 id="operations">Operations, reliability and release process</h2><p>The operations view brings together intents, stale settlement, provider events, support cases, scheduled-check evidence and product issues. Structured Cloudflare logs and traces are enabled for production debugging, with full invocation logs and sampled traces. Sensitive data still requires minimization before external log export.</p>
        <div className="docsMetrics"><div><strong>99.95%</strong><span>App availability target, excluding upstream outages</span></div><div><strong>≥ 98%</strong><span>Route-quote success target when routing is available</span></div><div><strong>100%</strong><span>Transaction traceability target</span></div><div><strong>15 min</strong><span>Stale-transaction investigation threshold</span></div><div><strong>15 min</strong><span>Urgent acknowledgement target during coverage</span></div><div><strong>1 business day</strong><span>Normal first-response target</span></div></div>
        <p>These are launch operating targets, not historical performance claims or customer guarantees. The release model has only development and production. Local development uses emulated Cloudflare services. Production candidates should be uploaded as versioned Workers, checked with smoke tests and canary traffic, then promoted or rolled back. Database migrations are forward-only and reviewed separately from application rollout. Repository checks include unit and browser tests, accessibility assertions, CodeQL, dependency audit, a read-only mainnet preflight, production smoke checks and an isolated D1 recovery drill.</p>
        <div className="docsWarning"><strong>Remaining edge gates.</strong> A custom production domain, WAF and rate-limit policy, API Shield where appropriate, Cloudflare Access for operations, version affinity where needed, Turnstile keys and durable external log export are not yet active. They are launch work, not hidden claims.</div>

        <h2 id="fees">Fees, incentives and alignment</h2><p>Aurel currently charges no product fee and configures no LI.FI integrator fee. Network gas, protocol interest, bridge or exchange costs, price impact and provider charges can still apply and should appear in the relevant quote or protocol state.</p><p>Before any subscription, spread, interchange share, referral payment, assets-under-interface fee or benefit charge becomes active, it must be disclosed in the product and documentation. Aurel has no house token. Product inclusion should be based on customer utility, risk, liquidity, operational reliability and documented review—not on creating demand for a proprietary asset.</p>

        <h2 id="regulated">Fiat, identity, cards and regulated services</h2><p>No bank account, fiat transfer, conversion, card, insurance, airport lounge, eSIM or lifestyle provider is active. These services require commercial contracts and, where applicable, regulated onboarding, sanctions screening, source-of-funds review, fraud controls, safeguarding, disputes, complaints, disclosures and country approval.</p><p>A future Bridge, Rain or equivalent relationship would not make Aurel’s own responsibilities disappear. The provider can own regulated onboarding and the regulated account or card record, while Aurel remains responsible for accurate product presentation, access control, complaint routing, vendor oversight, security, marketing claims and the activities it performs itself. The exact allocation must be written into contracts and procedures before launch.</p>

        <h2 id="status">Product status</h2><div className="statusMatrix statusMatrixDetailed">{statusRows.map(([state, feature, description]) => <div key={feature}><Status state={state} /><strong>{feature}</strong><span>{description}</span></div>)}</div>
        <div className="docsSource"><Scale size={18} /><p><strong>Important</strong>This documentation describes the current product architecture, controls and limitations. It is not legal, tax, accounting or investment advice. Protocols, networks and providers can change independently of Aurel. Verify critical details before every transaction.</p><div><a href="https://basescan.org" target="_blank" rel="noreferrer">BaseScan <ExternalLink size={12} /></a><Link href="/app/security">Security settings <ExternalLink size={12} /></Link></div></div>
        <footer className="docsFooter"><span>Aurel Trust Center</span><span>Last reviewed 21 September 2026</span></footer>
      </article>
    </main>
  </div>;
}
