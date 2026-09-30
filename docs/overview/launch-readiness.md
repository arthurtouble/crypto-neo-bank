---
title: Aura launch readiness
description: Evidence required before Aura can serve customers with real financial actions.
---

Last reviewed: 24 September 2026. Describes the source branch, not the deployed Worker. The detailed release register is `docs/archive/aura-production-release-plan-2026-09-24.md`; the earlier readiness ledger is historical.

## Current decision

**No production launch approval.** `main` deploys to the isolated dev Worker (`aura-dev.aurel-events.workers.dev`); nothing is deployed to production.

- Bank transfers, cards, and card payments still need provider programs. Rewards and Invest were cut; stocks and gold are bought in Swap.
- Onchain actions (send, swap, cross-chain, Aave, Morpho) share one [money actions](../architecture/money-actions.md) pipeline. The account is a Privy embedded wallet, upgraded in place with EIP-7702, and Privy pays gas ([accounts and custody](../architecture/accounts-and-custody.md)).
- Funded actions run on dev so far: a deposit from Ethereum to Base, a send on Base, a send from Base to Ethereum, a USDC to AAPLc swap, a deposit into and full withdrawal from a Morpho vault, a 1 USDC Aave deposit and 0.5 USDC withdrawal, a 1 USDC send from Base to Arbitrum, and 1 USDC received from outside Aura, listed in Transactions.
- A displayed provider capability is not a live feature.
- Not yet evidenced: the production hostname, provider programs, secrets, staffed operations, independent security review, and real-customer rehearsals.

## Release gates

1. **Scope and claims:** the contracting entity, product eligibility by country, Terms, privacy, risk and product disclosures, complaints, retention, and marketing claims are confirmed. Provider KYC does not establish availability for every Aura product in every country.
2. **Provider programs:** each launched program has approved production access, defined compliance and support responsibility, tested webhooks and reconciliation, and a named escalation contact. Card payments on a public Aura tag need a separate acquiring or payment-link provider.
3. **Money and security:** an independent review closes critical and high findings. Every released action kind has exact prepared calls, one customer signature, verification from chain evidence (operation identity, finality, expected events, and delivery for cross-chain routes), audit evidence, and a tested feature switch. Providers and chains stay authoritative for balances and transactions.
4. **Infrastructure:** configured and evidenced: a custom HTTPS domain, production Privy origin, Privy TEE execution, gas sponsorship, and MFA, Intercom (Messenger security with JWT enforced, Fin data connector token, production app), Cloudflare edge controls, Access, secrets, D1 migration and backup, logs, alerting, and the restore runbook.
5. **Operations:** staffed and exercised: primary and backup incident owners, provider escalation paths, support coverage, out-of-band customer communication, dispute handling, fraud and sanctions handoff, and rollback or forward-fix procedures.
6. **Acceptance:** recorded: desktop and mobile flows, five uncoached customer journeys, controlled funded movements on every published route, delayed or failed settlement recovery, and a post-release smoke pass. Financial switches stay off until their feature passes this gate.

Next: the ordered steps and owner go-aheads are in [production launch](../operations/production-launch.md), and `pnpm production:check` lists what the Worker configuration lacks. See [build status](build-status.md), [edge security activation](../operations/edge-security-activation.md), and the [acceptance plan](../operations/acceptance-test-plan.md).
