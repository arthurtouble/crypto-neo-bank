# Aurel partner diligence brief

## Executive summary

Aurel is a customer-controlled financial interface for stablecoins, public-chain protocols and, after approval, regulated fiat and card services. Base is the home network. Privy provides authentication and wallet infrastructure. Customers—not Aurel—confirm wallet transactions. Public chains, protocols and regulated providers remain authoritative for balances and settlement; Aurel does not operate a shadow bank ledger.

The initial partner request is a closed USDC-first beta with 25 invited users, expanding to 100 only after operational evidence meets the gates in `CLOSED_BETA_PLAN.md`. Bank accounts, fiat conversion and cards remain disabled until contracts, jurisdiction approval, end-to-end reconciliation and customer disclosures are complete.

## Product and customer

- Intended customer: digitally sophisticated internationally mobile professionals, founders and investors who already hold stablecoins.
- Initial proposition: one calm interface for self-controlled wallets, USDC movement, curated DeFi, security policy, support and membership.
- No house token, deposit promise, guaranteed yield or balance-sheet lending.
- Proposed initial limits: USD 25,000 of Aurel-prepared movement per rolling 24 hours; USD 1,000 new-destination threshold with a 24-hour cooling period.
- Proposed beta geography: only countries explicitly accepted in writing by the selected provider and launch counsel. No implied global availability.

## System boundary

1. Privy verifies the session and presents wallet confirmation.
2. Aurel validates the instruction, disclosures, allowlists, limits and cooling rules.
3. The customer signs; Aurel cannot independently sign.
4. The chain, protocol or provider executes and remains authoritative.
5. Aurel retains policy, consent, event and support evidence and keeps a rebuildable financial projection.

Cloudflare Workers hosts the application and APIs. D1 stores non-authoritative projections and retained operational evidence. Queues isolate provider-event intake from processing; failed events enter a dead-letter queue and create critical operations issues. A scheduled reconciliation scans stale transactions, expired reviews and failed or stuck events every five minutes.

## Controls already implemented

- Server-side Privy token verification and subject-scoped records.
- Customer signing; no Aurel customer private keys.
- Supported chain/asset allowlists and transaction-plan validation.
- RPC simulation for direct sends; exact approvals for routed ERC-20 movements.
- Emergency lock, destination allowlist, cooling periods, rolling limits and step-up threshold.
- Signed, timestamped, replay-resistant provider webhook intake.
- Idempotent queue processing, dead-letter evidence and scheduled reconciliation.
- Deny-all-by-default operator authorization, structured audit evidence and support cases.
- Security headers, API abuse limits, CI, CodeQL, dependency audit and recovery drill.

## Requested partner capabilities

- Hosted or API-driven individual KYC and sanctions screening.
- Provider-held customer fiat account or virtual-account records.
- Fiat/stablecoin conversion and payout/collection rails with explicit settlement states.
- Card issuing, authorization, clearing, disputes and chargebacks if supported.
- Signed events, idempotency, sandbox fixtures, reconciliation exports and incident escalation.
- Written country, customer-type, volume, asset, use-case and marketing approval.

## Forecast inputs requested from partner

The partner should quote setup fees, monthly minimum, per-customer KYC, enhanced due diligence, account, transfer, conversion, card, authorization, dispute, chargeback, FX, stablecoin and reserve requirements. Aurel will not model undisclosed economics as zero. Forecast volumes will be supplied as low/base/high scenarios after the allowed countries and pricing basis are known.

## Evidence package

- Architecture and source-of-truth rules: `ARCHITECTURE.md`
- Security model: `THREAT_MODEL.md` and `SECURITY_REVIEW.md`
- Operating and incident process: `OPERATIONS_RUNBOOK.md`
- Responsibility allocation: `COMPLIANCE_RESPONSIBILITY_MATRIX.md`
- Provider comparison: `PROVIDER_REQUIREMENTS_MATRIX.md`
- Beta limits and progression: `CLOSED_BETA_PLAN.md`
- Acceptance protocol: `ACCEPTANCE_TEST_PLAN.md`

## Open approval items

Legal entity, launch countries, customer terms, privacy notice, data retention, provider allocation, safeguarding language, complaints ownership and marketing claims require written approval before regulated features are enabled. This brief is an integration and diligence artifact, not legal advice or a claim that Aurel is licensed.
