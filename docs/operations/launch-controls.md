---
title: Launch controls
description: Server-side controls, success measures, stop conditions, and limit changes for an open product.
---

## Purpose

Aura is open to anyone who signs in. Safety comes from server-side controls, not from limiting who may join. Fiat accounts, conversion, and cards stay unavailable until a regulated provider is contracted and reconciled end to end.

## Controls

- **Feature switches** (`feature_flags`, operations console): `direct_transfers`, `swaps`, `cross_chain`, `defi_actions`, `tokenized_markets`, `fiat_accounts`, `payment_cards`, `support_assistant`. All default off. Every money-moving route and the database commit guards recheck them, so switching one off stops new preparation immediately. An `operations` audience limits a feature to operators.
- **Account lock** (`security_profiles.account_locked`): blocks review, preparation, passkey challenges, and hash claims for one customer.
- **Daily limit** (`security_profiles.daily_limit_usd`, default USD 25,000 rolling 24 hours): enforced in the atomic preparation write and again at passkey consumption. Customers can lower it; raising it needs a verified recovery path.
- **New-destination cooling** and step-up thresholds from the transaction policy.

## Success measures

- 90% of activated customers complete setup without staff intervention.
- At least 98% completion for supported flows, excluding customer rejection and documented upstream outage.
- 100% of Aura-created transactions have an instruction, policy result, state history, and source evidence.
- No unexplained projection-versus-chain/provider break stays open beyond one business day.
- Urgent cases acknowledged within 15 minutes during published coverage; normal cases within one business day.
- No critical/high unresolved security finding, misleading product claim, or unsupported jurisdiction exposure.

## Stop conditions

Switch off the affected feature immediately for signer ambiguity, incorrect destination/amount, authentication boundary failure, provider event replay, unexplained balance/settlement discrepancy, data exposure, sanctions instruction, repeated routing failure, or inability to provide incident coverage. Lock individual accounts for suspected compromise. Do not rely on UI copy alone.

## Daily operating review

- Scheduled reconciliation result and open critical/high issues.
- Submitted transactions older than 15 minutes.
- Failed/dead-letter provider events and replay evidence.
- Support queue, suspected account compromise, and complaint escalation.
- Upstream status, quote failure rate, and customer-visible degradation.
- Deployment/version changes and rollback readiness.

## Turning features on or raising limits

Enabling a financial feature for customers, or raising the default limit, requires written sign-off from product/security, operations/support, and legal/compliance owners. Attach acceptance evidence, unresolved exceptions, current limits, current disclosures, and the switch-off test.
