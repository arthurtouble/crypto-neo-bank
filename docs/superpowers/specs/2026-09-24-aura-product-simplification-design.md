# Aura product simplification design

Date: 2026-09-24
Status: Approved for implementation on 24 September 2026; production release gates remain in [the release plan](../../operations/aura-production-release-plan.md)
Branch: `codex/aura-product-simplification` at `1a8508da2bab4cab9847ba7789aefa408cb12275`

## Outcome and boundaries

Aura is the customer-facing name for a simpler financial interface. A visitor can browse every product section using unmistakably labeled example data. Signing in is required before any personal record, quote tied to a wallet, or financial action. The existing invitation check remains a separate requirement for real account access. The interface must never imply a disconnected provider feature is live. Chain and contracted providers remain authoritative for balances, positions, transactions, card state, eligibility, and settlement; D1 keeps operational instructions, evidence, and rebuildable projections only.

The operating and contracting entity is still open in the legal decision register. Rename customer-facing product copy, logo, metadata, and Aura tag. Preserve package names, environment variables, database identifiers, event names, historical records, legal entity placeholders, and external deployment identifiers unless a compatibility migration or verified legal decision requires otherwise. Existing URLs should redirect to the new navigation where safe.

## Approach

Use the existing app, tokens, components, Privy boundary, LI.FI flow, Aave reads, Bridge adapter, card projection, and security controls. Reorganize and delete customer-facing overbuild rather than create another app or parallel design system. Two alternatives were considered: a new frontend over the APIs would duplicate auth and financial safeguards; broad renaming of every internal `aurel` identifier would add migration risk without customer value. The narrow product-layer refactor is recommended.

## Product structure

| Area | Customer surface | Live boundary |
| --- | --- | --- |
| Overview | Cash (stablecoins), Vaults, Portfolio, recent transactions | Real values only from connected chain/provider reads; examples stay separate |
| Deposit | Crypto, bank, Aura tag | Bank instructions only from an active Bridge-backed account |
| Send | Address, Aura tag, contacts, bank, saved recipients | Existing destination cooling, limits, step-up, simulation, and settlement checks apply; bank requires Bridge activation |
| Swap | LI.FI asset search and cross-chain quote/review | Preserve current governed preparation and route/error states; signing only where current gates allow |
| Earn | Curated Aave vaults; Sky/Morpho only after adapters and validation | Position reads and writes have separate states; never enable deposit/withdraw from a read-only adapter |
| Borrow | Aave debt, cost, health, repay | Show debt from Aave; writes remain gated by existing policy and fresh risk checks |
| Invest | Crypto, tokenized stocks, metals | Crypto may route through supported swap; regulated products require issuer, venue, eligibility, and order provider |
| Cards | Card status and requested controls | Issuer-backed Bridge/Rain data and mutations only; all unconnected controls say unavailable |
| Rewards | Cashback and benefits | No earned amount or entitlement without a provider record |
| Transactions | Evidence-backed detail and card-dispute entry | A dispute entry opens only for an issuer transaction with a connected dispute route |
| Insights | Spending and investments | No fabricated history, totals, or performance; coverage gaps remain visible |
| Settings | Account, sign-in, passkeys, sessions, passcode, wallet export, transfer limits, wealth protection, privacy, statements, notifications, theme | Keep existing security/recovery records and honest unavailable states |
| Support | Assistant, contact, docs, FAQs | Reuse read-only assistance and protected support intake, remove concierge framing |

The primary navigation follows those names and groups only where needed for scanability. Remove customer entry points for markets lists, alerts, goals, schedules, paycheck planning, external-wallet tracking, concierge, and waitlist. Do not drop their historical D1 tables or audit evidence. Keep restricted operations routes outside customer navigation and retain API compatibility until callers are removed and retention is reviewed.

## Browse mode and identity boundary

`/app` and every named section render static, clearly labeled example data for signed-out visitors. Example data comes from a small local fixture that cannot be mistaken for a user, cannot invoke authenticated APIs, and has no active financial buttons. The same navigation remains visible after sign-in. Authenticated account views call existing protected endpoints only after Privy is ready; invitation, country, wallet ownership, policy, feature flags, and step-up checks remain enforced server-side. If an auth or provider read fails, show an unavailable state rather than fall back to examples. No browser storage key can switch a real account into an apparent example balance or bypass a gate.

## Aura tag and public payment page

Add a minimal D1 tag registry: normalized unique tag, owner subject reference, creation/update timestamps, and public-page enabled state. It is an address directory, not a balance or settlement ledger. Reserve and change tags through authenticated, rate-limited endpoints; prevent reserved names, case collisions, control characters, and reassignment races. A public `/pay/[tag]` page reveals only the opted-in display name, tag, supported network/address, and available methods. Unknown or disabled tags have the same plain unavailable response; no email, subject ID, wallet inventory, or account status leaks.

The page shows **Crypto**, **Bank transfer**, and **Card payment**. Crypto displays a current, owner-verified receiving address/network and a copy/QR action when available. Bank transfer details appear only after an active Bridge account, program permission to expose inbound details, and owner opt-in; otherwise the method says unavailable. Card payment requires a contracted acquiring/payment-link provider, an authorized server-created link, and verified status/webhooks; until then the page says unavailable and offers no fake checkout. An authenticated Aura-tag send resolves the current verified destination on the server, then reuses the existing send review and policy path. A stale or changed resolution must invalidate review before signing.

## Landing and visual contract

Use `apps/web/public/design-system.html` and current CSS variables: green/stone palette, typography, focus styles, and compact spacing. The supplied [N26 page](https://n26.com/en-eu) is a hierarchy reference only: clear hero, visual feature storytelling, FAQ, closing CTA, and linked qualifications. Use original Aura copy and product imagery, not N26 assets or wording. Feature imagery should be real captures or illustrations of Aura screens with fictional data, reviewed at desktop and mobile widths.

Exact content order: header with logo, navigation, Get Started; hero with **Your Smart Account** and “Spend anywhere, invest in global markets, and get incredible rewards. All from one app.”; Get Started CTA fixed at the bottom on mobile; eight rounded cards titled **A home for all your assets**, **Spend**, **Earn**, **Send**, **Invest**, **Borrow**, **Rewards**, and **Security**, each with a short description and imagery; expandable FAQs; closing Get Started; footer. The Security card covers Self-Custodial, Bank-Grade Partners, and Audits with precise status and linked qualifications. Claims for spend, bank partners, securities, rewards, and audits must point to status, risk, security, or provider qualification pages, and copy must clearly distinguish available from planned. No waitlist CTA. Cards should be slightly rounder than the current system, with proportional small labels and restrained spacing.

## Safety, data, and migration

Keep the existing intent preparation, wallet ownership, invitation, limits, cooling, feature flags, passkey step-up, exact-call checks, simulation, reconciliation, incident switches, recovery, and retained audit events. UI removal must not remove server checks or financial history. One additive migration creates the tag registry with unique normalized tags and an owner index; no destructive migration. Existing privacy, terms, status, support, and product documentation must reflect Aura while retaining draft legal-party language. All newly visible provider features have an explicit unavailable or setup state.

## Acceptance

1. Visitor can browse every section and sees an example-data label on every example financial view; no personal API fetch or action occurs before auth.
2. Real account reads stay subject to existing auth and invitation gates; failure never renders example data as personal data.
3. Aura tag is unique, owner-bound, opt-in for public display, rate-limited, and resolves to a verified destination; bank/card methods cannot appear operational without provider evidence.
4. Retained historical, security, invitation, and recovery records survive; removed customer routes redirect or become unavailable without deleting data.
5. Desktop and mobile views follow the design system, keyboard navigation and focus work, and the mobile CTA does not cover content.
6. Unit/integration/e2e checks cover these boundaries, and docs/build/type/lint checks pass. No production deployment or live provider activation is part of this work.
