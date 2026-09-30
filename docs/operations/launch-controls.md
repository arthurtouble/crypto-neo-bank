---
title: Launch controls
description: Server-side controls, success measures, stop conditions, and limit changes for an open product.
---

Aura is open to anyone who signs in; safety comes from server-side controls, not from limiting who may join. Fiat accounts, conversion, and cards stay unavailable until a regulated provider is contracted and reconciled end to end.

## Controls

- **Feature switches** (`feature_flags`, operations app → Controls): each is on or off for everyone: `direct_transfers`, `swaps`, `cross_chain`, `defi_actions`, `fiat_accounts`, `payment_cards`, `card_wallets` (Apple and Google Pay). All default off. `POST /api/actions` checks the switch for each action and the `/api/cards` routes check `payment_cards`, so switching one off stops new preparation at once. Turning off `payment_cards` doesn't freeze existing cards; freeze them at Stripe.
- **Customer controls** (`security_profiles`, set in Settings and audited; tightening applies immediately, loosening needs a server-verified passkey confirmation):
  - Account lock blocks every action, including ones prepared before it.
  - Daily limit (`daily_limit_cents`, off by default) caps the rolling 24-hour USD value of sends and routes that pay another address. Swaps and earn moves within the customer's own wallet don't count.
  - Saved recipients only (`enforce_address_book`, off by default).
  - New-recipient cooling (`new_address_delay_seconds`, default 4 hours), only when saved recipients only is on.
- **Operator lock** (operations app → Customers, `POST /api/ops/accounts/:subject/lock`): an operator can lock an account, with a reason, to protect its customer. It sets the same account lock, so sending stops at once, tries to freeze the card at Stripe (best effort), audits the operator's email, and tells the customer by email and in the app. Only the customer can unlock it, in Settings with their passkey.
- **Closed accounts** (`subject_profiles.closed_at`): an operator closes an account at the customer's request once it holds no funds and nothing is in progress (`/api/ops/accounts`, operations app → Customers). It is locked, its Aura tag unpublished, and `requireVerifiedSubject` refuses it everywhere except support, terms, and the data download.
- **Passkey requirement** (`requireMoneyMfa`, or `requireMoneyAccount`, which checks it and picks the account from the same Privy read, in `apps/web/src/lib/auth/wallet.ts`): `POST /api/actions`, `POST /api/actions/:id/submit`, and `POST /api/money/payouts` refuse with `mfa_required` unless the customer has a passkey or authenticator app in Privy, and the app opens Privy's enrollment. An email or SMS code alone can't move money.
- **Blocked places** (`apps/web/src/lib/legal/places.ts`): requests from places under comprehensive sanctions get 451 for the app, the API, and payment pages, at the Worker, before any handler runs. See [legal and jurisdiction decisions](../compliance/legal-and-jurisdiction-decisions.md#blocked-places).
- **Asset registry and pauses** (`apps/web/src/lib/assets/registry.ts`, `asset_pauses`): only registered assets can be shown, deposited, sent, swapped, or bought. An operator can pause an asset, with a reason, in the operations app (`/api/ops/assets`), stopping new actions in it at once. See [assets](../architecture/assets.md).

These controls bind actions Aura prepares. They do not bind a key the customer exports and uses elsewhere. See [money actions](../architecture/money-actions.md).

## Success measures

- 90% of activated customers complete setup without staff intervention.
- At least 98% completion for supported flows, excluding customer rejection and documented upstream outage.
- 100% of Aura-prepared actions have prepared calls, a control result, status events, and chain evidence.
- No unexplained break between projections and the chain or provider stays open beyond one business day.
- Case response times as in the runbook's [service targets](operations-runbook.md#service-targets).
- No critical/high unresolved security finding, misleading product claim, or unsupported jurisdiction exposure.

## Stop conditions

Switch off the affected feature at once for signer ambiguity, wrong destination or amount, authentication boundary failure, provider event replay, unexplained balance or settlement discrepancy, data exposure, a sanctions instruction, repeated routing failure, or no incident coverage. Lock individual accounts for suspected compromise. Never rely on UI copy alone.

## Daily operating review

- Scheduled reconciliation result and open critical/high issues.
- Actions `submitted` or `settling` for more than 15 minutes.
- Failed and dead-letter provider events, and replay evidence.
- Support queue, suspected account compromise, and complaint escalation.
- Upstream status, quote failure rate, and customer-visible degradation.
- Deployment and version changes, and rollback readiness.

The runbook's [daily controls](operations-runbook.md#daily-controls) give the checks in detail.

## Turning features on or raising limits

Needs written sign-off from the product and security, operations and support, and legal and compliance owners, with acceptance evidence, unresolved exceptions, current disclosures, and the switch-off test attached.
