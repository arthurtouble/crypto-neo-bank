---
title: Private beta
description: Invitations, cohorts, limits, feedback, and the rules for expanding access.
---

Aurel uses small cohorts to test reliability, recovery, and support before expanding access. Anyone can join the global waitlist, but product access remains limited by country, capacity, and feature readiness.

## Current access mode

The deployed product currently uses **preview mode**. Authenticated customers can explore implemented wallet and DeFi paths without an invitation. The invite-only control is implemented but remains off until the initial countries, beta terms, support coverage, and accountable operator are approved. The public waitlist is a separate, closed-by-default path.

When invite mode is enabled, access requires:

- a valid invitation that has not expired or reached its redemption limit;
- a two-letter country code allowed globally and by that invitation;
- acceptance of the effective private-beta terms;
- an active, non-suspended access record.

Invitation codes are shown once to the operator. Aurel stores a SHA-256 hash rather than the original code.

## Cohorts

### Internal acceptance

Five testers, including at least two people who do not routinely use crypto products. The cohort exercises authentication, recovery, funding, sending, Aave, routing, controls, support, and failure states.

### Founding customers

Up to 25 invited customers with direct support. Default Aurel-prepared movement is capped at $25,000 over a rolling 24 hours, with a $1,000 new-destination threshold and 24-hour cooling period.

### Controlled external beta

Up to 100 customers in approved countries. This cohort opens only after the prior cohort meets its reliability and support gates for two consecutive weeks.

## Limits

The effective transaction limit is the lower of the customer's security preference and the beta limit assigned by operations. A customer cannot raise the beta limit from the product interface.

Feature flags provide server-side kill switches for direct transfers, cross-chain routing, DeFi actions, concierge, membership preview, tokenized markets, fiat accounts, and cards. A disabled server feature cannot be restored by changing browser code.

## Feedback

Authenticated customers can send structured feedback from Settings. Feedback records the product surface, sentiment, topic, message, and review state. It does not ask for keys, recovery material, or identity documents.

## Expansion gates

Access does not expand while there is an unexplained financial-state difference, unresolved Critical or High security issue, missing incident coverage, unsupported country exposure, or a misleading product claim. Customer count is never the sole reason to expand.
