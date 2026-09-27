---
title: Aura launch readiness
description: Evidence required before Aura can serve customers with real financial actions.
---

Last reviewed: 24 September 2026. This describes the source branch, not the deployed Worker. The detailed release register is `docs/archive/aura-production-release-plan-2026-09-24.md` in the repository; the prior readiness ledger is historical.

## Current decision

**No production launch approval.** The public example-data product is implemented on `main`, which deploys to the isolated dev Worker (`aura-dev.aurel-events.workers.dev`); nothing has been deployed to production. Bank transfers, cards and card payments, and rewards still need provider programs or builders. Onchain actions (send, swap, cross-chain, Aave, Morpho) share one [money actions](../architecture/money-actions.md) pipeline. The account is a Privy embedded wallet, upgraded in place with EIP-7702, and Privy pays gas ([accounts and custody](../architecture/accounts-and-custody.md)). On dev, live funded actions so far: a deposit from Ethereum to Base, a send on Base, a send from Base to Ethereum, a swap from USDC to a tokenized stock (AAPLc), and a deposit into and full withdrawal from a Morpho vault. Invest was cut; stocks and gold are bought in Swap. A displayed provider capability is not a live feature. The production hostname, provider programs, secrets, staffed operations, independent security review, and real-customer rehearsals are not yet evidenced.

## Release gates

1. **Scope and claims:** Confirm the contracting entity, product eligibility by country, Terms, privacy, risk and product disclosures, complaints, retention, and marketing claims. Provider KYC does not establish availability for every Aura product in every country.
2. **Provider programs:** Each launched provider program has approved production access, defined compliance and support responsibility, tested webhooks and reconciliation, and a named escalation contact. Card payments on a public Aura tag require a separate acquiring or payment-link provider.
3. **Money and security:** Independent review closes critical and high findings. Every released action kind has exact prepared calls, one customer signature, verification from chain evidence (operation identity, finality, expected events, and delivery for cross-chain routes), audit evidence, and a tested feature switch. Source providers and chains remain authoritative for balances and transactions.
4. **Infrastructure:** A custom HTTPS domain, production Privy origin, Privy dashboard settings for TEE execution, gas sponsorship, and MFA, Turnstile, Cloudflare edge controls, Access, secrets, D1 migration and backup, logs, alerting, and restore runbook are configured and evidenced.
5. **Operations:** Primary and backup incident owners, provider escalation paths, support coverage, out-of-band customer communication, dispute handling, fraud/sanctions handoff, and rollback/forward-fix procedures are staffed and exercised.
6. **Acceptance:** Desktop and mobile flows, five uncoached customer journeys, controlled funded movements on every published route, delayed/failed settlement recovery, and a post-release smoke pass are recorded. Financial switches stay off until that feature passes its gate.

See [Aura build status](build-status.md) for what is implemented and what still needs integration. The existing [edge security activation](../operations/edge-security-activation.md) and [acceptance plan](../operations/acceptance-test-plan.md) provide operator steps.
