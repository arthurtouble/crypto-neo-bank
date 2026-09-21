# Aurel build status

This is the execution checklist for the mainnet-first product. “Live” means the feature reads an authoritative provider or chain and never relies on an Aurel balance ledger. “Prepared” means the complete adapter, interface, state model, and simulation exist but a commercial provider or legal approval is still required.

## Product spine

- [x] Cloudflare Workers and Static Assets deployment
- [x] Disposable D1 projection database
- [x] Provider-event Queue and dead-letter Queue
- [x] Privy authentication UI
- [x] Server-side Privy access-token verification boundary
- [x] Base mainnet home-chain configuration
- [x] Multichain EVM wallet configuration
- [x] Embedded-wallet and external-wallet discovery
- [x] Live Base ETH, USDC, and WETH balance reads
- [x] Receive address and QR flow
- [x] User-confirmed Base ETH/ERC-20 send flow
- [x] Transaction-intent API, policy evaluation, consent, and submission state
- [x] Rebuildable provider/onchain portfolio view and authenticated intent activity feed

## Product workstreams

- [x] Passkey/MFA, recovery, export, and current-session center
- [x] Mainnet cross-chain USDC routing with LI.FI quote, exact approval, policy evaluation, and user signing
- [x] Curated Base mainnet Earn market, preparation, and user-signing flow
- [x] Aave collateral, borrow, repay, simulation, and health-factor flows
- [x] Membership qualification and vendor-neutral entitlement engine
- [x] Vendor-neutral rewards, lounge, eSIM, insurance, and concierge entitlement adapters
- [x] Read-only AI concierge with deterministic transaction separation
- [x] Feature-gated tokenized-asset framework
- [x] Operations and reconciliation console
- [x] Complete trust center and effective-dated disclosures
- [x] Production observability, abuse controls, security tests, and recovery exercise

## Deliberately external

- Bridge/Rain KYC, bank accounts, fiat rails, and cards remain behind provider interfaces.
- Benefit activation requires signed vendor programs.
- Tokenized securities remain disabled until issuer, venue, jurisdiction, and platform-role review.
- Every mainnet write requires an explicit wallet confirmation; automated tests never broadcast value-moving transactions.
- Membership qualification is presented as a current-balance projection until sufficient daily observations exist for a 30-day earned tier.
- External-wallet history beyond Aurel-created intents is read directly from the relevant chain explorer; Aurel does not maintain a proprietary transaction ledger.
