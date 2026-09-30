---
title: Partner diligence brief
description: Internal provider diligence package, questions, evidence, and approval gates.
---

## Summary

Aura is a customer-controlled financial interface for stablecoins, public-chain protocols and, after approval, regulated fiat and card services. Base is the home network; Privy provides authentication and wallets. Customers, not Aura, confirm wallet transactions. Public chains, protocols, and regulated providers are authoritative for balances and settlement; Aura runs no shadow bank ledger.

Aura is open to anyone who signs in. Each provider feature launches behind its own switch, USDC first, within the limits in [launch controls](../operations/launch-controls.md). Bank accounts, fiat conversion, and cards stay disabled until contracts, jurisdiction approval, end-to-end reconciliation, and customer disclosures are complete.

## Product and customer

- Intended customer: digitally sophisticated, internationally mobile professionals, founders, and investors who already hold stablecoins.
- Initial proposition: one interface for self-controlled wallets, USDC movement, curated DeFi, security policy, and support.
- No house token, deposit promise, guaranteed yield, or balance-sheet lending.
- Limits: no Aura-wide cap today. Customers can set a daily limit, saved-recipients-only mode, and a 4-hour wait for new recipients ([launch controls](../operations/launch-controls.md)); partner-specific limits are agreed per program.
- Geography: a provider feature is offered only in countries the provider and launch counsel accept in writing. Aura itself is available to anyone who can use it lawfully.

## System boundary

1. Privy verifies the session and presents wallet confirmation.
2. Aura validates the instruction, disclosures, allowlists, limits, and cooling rules.
3. The customer signs; Aura can't sign on its own.
4. The chain, protocol, or provider executes and stays authoritative.
5. Aura keeps policy, consent, event, and support evidence and a rebuildable financial projection.

Cloudflare Workers hosts the app and APIs. D1 stores non-authoritative projections and operational evidence. Queues separate provider-event intake from processing; failed events go to a dead-letter queue and open critical operations issues. Scheduled reconciliation scans stale transactions, expired reviews, and failed or stuck events every five minutes.

## Controls implemented

- Server-side Privy token verification and subject-scoped records.
- Customer signing; no Aura-held customer private keys.
- Supported chain/asset allowlists and transaction-plan validation.
- Exact server-built calls, with any ERC-20 approval batched into the same operation, and outcomes verified from chain evidence.
- Account lock, saved-recipients-only mode, new-recipient cooling, optional daily limit.
- Signed, timestamped, replay-resistant provider webhook intake.
- Idempotent queue processing, dead-letter evidence, scheduled reconciliation.
- Deny-by-default operator authorization, structured audit evidence, and Intercom support conversations tied to verified Aura identities.
- Security headers, API abuse limits, CI, CodeQL, dependency audit, recovery drill.

## Requested partner capabilities

- Hosted or API-driven individual KYC and sanctions screening.
- Provider-held customer fiat account or virtual-account records.
- Fiat/stablecoin conversion and payout/collection rails with explicit settlement states.
- Card issuing, authorization, clearing, disputes, and chargebacks if supported.
- Signed events, idempotency, sandbox fixtures, reconciliation exports, incident escalation.
- Written country, customer-type, volume, asset, use-case, and marketing approval.

## Forecast inputs requested from partner

Quote setup fees, monthly minimum, per-customer KYC, enhanced due diligence, account, transfer, conversion, card, authorization, dispute, chargeback, FX, stablecoin, and reserve requirements. Aura won't model undisclosed economics as zero. Volumes come as low/base/high scenarios once allowed countries and pricing basis are known.

## Evidence package

- Architecture and source-of-truth rules: [architecture](../architecture/architecture.md)
- Security model: [threat model](../security/threat-model.md) and [security review](../security/security-review.md)
- Operating and incident process: [operations runbook](../operations/operations-runbook.md)
- Responsibility allocation: [responsibility matrix](compliance-responsibility-matrix.md)
- Provider comparison: [provider requirements](provider-requirements-matrix.md)
- Limits, switches, and stop conditions: [launch controls](../operations/launch-controls.md)
- Acceptance protocol: [acceptance test plan](../operations/acceptance-test-plan.md)
- Fund and data flows: [fund and provider data](../architecture/fund-flow-and-provider-data.md)
- Volume and economics assumptions: [volume and economics](../product/volume-and-economics-inputs.md)
- Data retention: [data retention schedule](../operations/data-retention-schedule.md)
- External security review scope: [external review scope](../security/external-security-review-scope.md)

## Open approval items

Legal entity, launch countries, customer terms, privacy notice, data retention, provider allocation, safeguarding language, complaints ownership, and marketing claims need written approval before regulated features are enabled. This brief is an integration and diligence artifact, not legal advice or a claim that Aura is licensed.
