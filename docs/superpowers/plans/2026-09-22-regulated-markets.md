# Regulated Markets Implementation Plan

**Goal:** Make tokenized stocks and other regulated instruments understandable and discoverable in Aurel, while keeping orders unavailable until an approved distributor, venue, jurisdiction, and customer eligibility source are actually connected.

**Authority:** The issuer and approved market-data source own instrument metadata; a contracted eligibility provider owns KYC/product permissions; an approved venue owns execution and settlement. Aurel stores only document acknowledgements, decision references, audit events, and rebuildable views. A permissionless token route is not a substitute for those approvals.

**Why this boundary exists:** [xStocks developer documentation](https://docs.xstocks.fi/developers) separates public asset metadata from authenticated issuance, redemption, and RFQ access. [xStocks partner terms](https://xstocks.com/partner) place geographic compliance on partners. Its [legal overview](https://docs.xstocks.fi/docs/product-legal-overview) describes tracker certificates, not ordinary shares. [LI.FI's RWA terms](https://li.fi/legal/rwa-supplemental-terms) say LI.FI does not perform regulatory classification or compliance for integrators. These sources require a separate product gate even when a token is tradable on a DEX.

## Invariants

- No tokenized security is executable through generic Swap solely because its contract appears in LI.FI's token list or has a quote.
- The contract and chain identify the token; the issuer instrument ID identifies the legal product. Tickers are labels only.
- Do not infer country or customer classification from IP alone. A current provider decision and reviewed legal country matrix are both required for an order.
- No Aurel-admin toggle alone may enable orders. Partner agreement, legal sign-off, operational limits, and venue adapter must be recorded first.
- Unknown, expired, conflicting, or unreachable eligibility or market data fails closed. Read-only catalog may show an explicit unavailable state.
- Corporate actions, rebasing, transfer restrictions, documents, currency, trading hours, and market-data rights are instrument-level fields, not generic ERC-20 assumptions.
- No live-money order or test transaction in QA.

## Task 1 — Instrument identity and public catalog

Files: `apps/web/src/lib/markets/instruments.ts`, `apps/web/src/lib/markets/xstocks.ts`, `apps/web/src/app/api/markets/instruments/route.ts`, unit tests.

- [ ] Write failing tests for duplicate ticker, wrong chain/contract, stale document version, corporate-action multiplier, source outage, and unsupported product category.
- [ ] Add a versioned instrument schema: issuer, issuer instrument ID, legal type, rights summary, canonical token deployments, allowed/blocked country data provenance, product documents/effective dates, corporate-action model, public pricing authority, observed-at and freshness.
- [ ] Use the public xStocks asset/metadata endpoints only as a discovery adapter; parse against a strict schema and add bounded caching. Never label public metadata as Aurel approval. Prefer authoritative API IDs over ticker joins.
- [ ] Serve a paged, searchable, read-only catalog with source/freshness and no customer-specific eligibility claim. Keep Treasury/private-market rows view-only until a corresponding reviewed issuer adapter exists.
- [ ] Verify focused tests, full unit suite, typecheck, lint, and API error handling.

## Task 2 — Country, account, and document eligibility

Files: `apps/web/src/lib/markets/eligibility.ts`, `apps/web/src/lib/markets/eligibility-provider.ts`, `apps/web/src/app/api/markets/eligibility/route.ts`, D1 migration if evidence references need new fields, unit tests.

- [ ] Write failing tests for U.S. person abroad, restricted country, stale KYC, unknown nationality/residency, outdated document, provider outage, asset-specific restrictions, and expired venue permission.
- [ ] Separate public visibility from `canQuote`, `canOrder`, `canHold`, and `canTransfer`; default each permission to false. Decision output includes reason code, rule version, provider evidence reference, expiry, and evaluated-at.
- [ ] Add a provider adapter interface. The current adapter returns `partner_not_connected` for all order permissions. It must not manufacture a positive KYC result from `subject_profiles.country_code` or Privy authentication.
- [ ] Require current instrument documents and explicit versioned acknowledgement only where legal/product policy permits; store acknowledgements as non-authoritative evidence. Never treat a click as KYC or securities eligibility.
- [ ] Verify fail-closed behavior at every API boundary and document the partner onboarding fields needed to activate a real adapter.

## Task 3 — Dedicated order contract, disabled until approved

Files: `apps/web/src/lib/markets/orders.ts`, `apps/web/src/app/api/markets/orders/route.ts`, feature flag/migration, tests.

- [ ] Write failing tests proving neither an admin flag nor a LI.FI quote can create a regulated order without a partner-backed eligibility decision, venue configuration, current documents, and destination/ownership checks.
- [ ] Define `MarketExecutionAdapter` with server-side quote, idempotent create/cancel, status, expiry, fees, order size, settlement asset, and provider reference. Do not expose direct generic router calldata as a regulated order.
- [ ] Keep the default adapter explicitly unavailable and the `tokenized_markets` flag disabled. Add a separate `regulated_orders` switch if execution is ever enabled; read-only discovery is not controlled by that switch.
- [ ] When a contracted venue is added, independently reconcile its order and settlement statuses. Never mark an order filled from a browser callback or successful onchain receipt alone.

## Task 4 — Product UI and disclosure

Files: `apps/web/src/components/markets-workspace.tsx`, new instrument-detail component, design-system CSS, responsive E2E tests.

- [ ] Replace the three verbose placeholder cards with a searchable Stocks & Funds section and concise instrument details: issuer, product type, what the customer owns, price-source timestamp, underlying market status, corporate-action note, and relevant legal documents.
- [ ] Make availability unmistakable: “View Only” or a precise “Not Available in Your Region”/“Identity Review Required” state from the eligibility API. Do not show a live-looking Buy button when no venue is connected.
- [ ] Keep crypto Markets and regulated instruments visually coherent but distinct in routing, disclosures, and action labels. Do not put stocks in the generic Swap asset picker unless a formally reviewed eligibility/route policy permits that exact instrument and jurisdiction.
- [ ] Test desktop/mobile, keyboard, focus restoration, dark/light, empty/error states, and screen-reader labels.

## Task 5 — Documentation and release gate

- [ ] Update product and security docs with the actual catalog/eligibility status, tracker-certificate rights, price versus executable quote distinction, partner authority, corporate actions, and country restrictions. Remove claims that ordinary stock ownership or live trading is available before it is.
- [ ] Publish a country/product matrix and partner due-diligence checklist for legal review; do not present it as final legal advice.
- [ ] Run unit, E2E, typecheck, lint, docs build, migration/recovery drill, and read-only production smoke. Verify both order switches remain off. Activate only under a separate reviewed partner and legal rollout.

**Dependency:** Program 2's canonical asset identity and screening must block regulated contracts from generic Swap. Program 1's transaction evidence is reused only if the eventual venue settles via user-signed onchain calls; provider order state remains the order authority.
