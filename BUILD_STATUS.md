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
- [ ] Rebuildable multichain portfolio index and activity feed

## Product workstreams

- [x] Passkey/MFA, recovery, export, and current-session center
- [ ] Swap and cross-chain routing adapter with Privy-first and LI.FI fallback
- [x] Curated Base mainnet Earn market, preparation, and user-signing flow
- [x] Aave collateral, borrow, repay, simulation, and health-factor flows
- [x] Membership qualification and vendor-neutral entitlement engine
- [ ] Rewards, lounge, eSIM, insurance, and concierge adapters
- [ ] Read-only AI concierge and draft-intent tools
- [ ] Feature-gated tokenized-asset framework
- [ ] Operations and reconciliation console
- [ ] Complete trust center and effective-dated disclosures
- [ ] Production observability, abuse controls, security tests, and recovery exercise

## Deliberately external

- Bridge/Rain KYC, bank accounts, fiat rails, and cards remain behind provider interfaces.
- Benefit activation requires signed vendor programs.
- Tokenized securities remain disabled until issuer, venue, jurisdiction, and platform-role review.
- Every mainnet write requires an explicit wallet confirmation; automated tests never broadcast value-moving transactions.
