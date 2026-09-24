---
title: Private-beta operations
description: How operators manage cohorts, invitations, limits, feature flags, analytics, and feedback.
---

The operations surface is deny-all unless the Privy subject appears in the explicit operator allowlist. Cloudflare Access can be required as a second perimeter control after an operator hostname and identity provider are configured.

## Invitations and cohorts

An operator creates a labeled invitation for a named cohort, redemption count, optional expiry, and optional country list. The plaintext code appears only in the creation response. Only its hash is retained.

Redemption creates a subject-scoped access record containing cohort, country, status, terms version, accepted time, activation time, and transaction cap. An access record can be suspended without changing wallet ownership.

The closed waitlist is separate from product access. Authorized operators can review historical waitlist records. An approximate IP country hint is context only; the operator checks eligibility through a separate approved process before issuing an invitation.

## Growth operations

Waitlist intake, referrals, campaigns, experiments, and public growth-event collection are retired. Historical records remain available to authorized operators for access evidence and data requests. Operators create invitations through the separate invitation controls; plaintext codes are shown once and must be sent through an approved contact process.

## Feature kill switches

Feature flags are read by server APIs before transaction or support-assistant work begins. Changes create operator audit evidence. Current flags cover direct transfers, cross-chain routing, DeFi actions, the support assistant, membership preview, tokenized markets, fiat accounts, and cards.

The browser may also hide an unavailable feature, but browser presentation is never the enforcement layer.

## Product analytics

The 30-day operations view separates:

- total and new customers;
- approved product events and distinct customers;
- transaction intent states;
- support volume and priority;
- feedback sentiment and topic;
- access by cohort and state.

Analytics records are not balance evidence. Values and provider settlement remain authoritative at their source.

## Daily review

Review new customers, activation completion, blocked/prepared/submitted/confirmed intents, stale transactions, support cases, feedback, dependency status, queue failures, and deployments. Investigate ratios and individual exceptions rather than treating a dashboard total as proof of safety.

## Stop conditions

Disable the affected feature for signer ambiguity, changed destination or amount, authentication failure, event replay, unexplained settlement difference, data exposure, sanctions instruction, repeated route failure, or missing incident coverage.

## Access activation

Before setting `BETA_ACCESS_MODE=invite`, finalize the allowed-country configuration, effective terms version, operator allowlist, Cloudflare Access policy, support coverage, and a tested invitation. Changing the mode without those controls will correctly deny customers who lack an active invitation.
