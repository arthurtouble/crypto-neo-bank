---
title: Aura launch readiness
description: Evidence required before Aura can serve customers with real financial actions.
---

Last reviewed: 24 September 2026. This describes the source branch, not the deployed Worker. The detailed release register is `docs/archive/aura-production-release-plan-2026-09-24.md` in the repository; the prior readiness ledger is historical.

## Current decision

**No production launch approval.** The public example-data product is implemented on `codex/aura-product-simplification`; this branch has not been deployed. Bank transfers, cards and card payments, investing, rewards, vault writes, Aave writes, and some security settings still need provider programs or execution adapters. A displayed provider capability is not a live rail. The production hostname, provider programs, secrets, staffed operations, independent security review, and real-customer rehearsals are not yet evidenced.

## Release gates

1. **Scope and claims:** Confirm the contracting entity, product eligibility by country, Terms, privacy, risk and product disclosures, complaints, retention, and marketing claims. Provider KYC does not establish availability for every Aura product in every country.
2. **Provider programs:** Each launched rail has approved production access, defined compliance and support responsibility, tested webhooks and reconciliation, and a named escalation contact. Card payments on a public Aura tag require a separate acquiring or payment-link provider.
3. **Money and security:** Independent review closes critical and high findings. Every released customer action has exact-call policy, customer authorization, simulation where applicable, settlement verification, recovery handling, audit evidence, and a tested kill switch. Source providers and chains remain authoritative for balances and transactions.
4. **Infrastructure:** A custom HTTPS domain, production Privy origin and passkey RP ID, Turnstile, Cloudflare edge controls, Access, secrets, D1 migration and backup, logs, alerting, and restore runbook are configured and evidenced.
5. **Operations:** Primary and backup incident owners, provider escalation paths, support coverage, out-of-band customer communication, dispute handling, fraud/sanctions handoff, and rollback/forward-fix procedures are staffed and exercised.
6. **Acceptance:** Desktop and mobile flows, five uncoached customer journeys, controlled funded movements on every published route, delayed/failed settlement recovery, and a post-release smoke pass are recorded. Financial flags remain disabled until the specific rail passes its gate.

See [Aura build status](build-status.md) for what is implemented and what still needs integration. The existing [edge security activation](../operations/edge-security-activation.md) and [acceptance plan](../operations/acceptance-test-plan.md) provide operator steps.
