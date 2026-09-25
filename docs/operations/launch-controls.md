---
title: Launch controls
description: Server-side controls, success measures, stop conditions, and limit changes for an open product.
---

## Purpose

Aura is open to anyone who signs in. Safety comes from server-side controls, not from limiting who may join. Fiat accounts, conversion, and cards stay unavailable until a regulated provider is contracted and reconciled end to end.

## Controls

- **Feature switches** (`feature_flags`, operations console): `direct_transfers`, `swaps`, `cross_chain`, `defi_actions`, `fiat_accounts`, `payment_cards`. All default off. `POST /api/actions` checks the switch for each action, so switching one off stops new preparation immediately.
- **Customer controls** (`security_profiles`, set in Settings, applied immediately and audited):
  - Account lock blocks every action.
  - Daily limit (`daily_limit_cents`, off by default) caps the rolling 24-hour USD value of sends and routes that pay another address. Swaps and earn moves within the customer's own wallet don't count.
  - Saved recipients only (`enforce_address_book`, off by default).
  - New-recipient cooling (`new_address_delay_seconds`, default 4 hours).

These controls bind actions Aura prepares. They do not bind a key the customer exports and uses elsewhere. See [money actions](../architecture/money-actions.md).

## Success measures

- 90% of activated customers complete setup without staff intervention.
- At least 98% completion for supported flows, excluding customer rejection and documented upstream outage.
- 100% of Aura-prepared actions have prepared calls, a control result, status events, and chain evidence.
- No unexplained projection-versus-chain/provider break stays open beyond one business day.
- Urgent cases acknowledged within 15 minutes during published coverage; normal cases within one business day.
- No critical/high unresolved security finding, misleading product claim, or unsupported jurisdiction exposure.

## Stop conditions

Switch off the affected feature immediately for signer ambiguity, incorrect destination/amount, authentication boundary failure, provider event replay, unexplained balance/settlement discrepancy, data exposure, sanctions instruction, repeated routing failure, or inability to provide incident coverage. Lock individual accounts for suspected compromise. Do not rely on UI copy alone.

## Daily operating review

- Scheduled reconciliation result and open critical/high issues.
- Actions `submitted` or `settling` for more than 15 minutes.
- Failed/dead-letter provider events and replay evidence.
- Support queue, suspected account compromise, and complaint escalation.
- Upstream status, quote failure rate, and customer-visible degradation.
- Deployment/version changes and rollback readiness.

## Turning features on or raising limits

Enabling a financial feature for customers requires written sign-off from product/security, operations/support, and legal/compliance owners. Attach acceptance evidence, unresolved exceptions, current disclosures, and the switch-off test.
