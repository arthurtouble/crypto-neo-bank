---
title: External security review scope
description: Required scope and evidence for independent security assessment.
---

## In scope

- Privy: token verification, subject isolation, embedded wallet binding, passkey requirement, relay signature checks, recovery/export presentation.
- Action preparation (`POST /api/actions`): call fingerprinting, hash binding, expiry, status transitions.
- The verifier: operation identity (decoded calls equal prepared calls), finality, expected events, cross-chain delivery.
- LI.FI quotes: server-held storage, Diamond pinning, price-impact and slippage bounds, batched ERC-20 approvals.
- Account lock, daily limit, saved-recipients-only mode, recipient cooling, valuation, and feature switches on every action.
- Operator authorization: the operations Worker's forwarding over the service binding (headers passed, paths refused); Cloudflare Access token verification in the web app (signature, key rotation, issuer, audience, expiry, service tokens refused); operator audit records, the operator lock, and feature switches.
- Webhooks: per-provider verification (Bridge RSA, Privy Svix, Stripe HMAC-SHA256), customer resolution through `provider_customer_links` (Stripe card events through `card_account_projections`), replay prevention, queue retries, dead-letter processing, reconciliation.
- D1 migrations, evidence integrity, backup/export/restore, log minimization, incident procedures.
- Cards: passkey step-up for card details, unfreezing, and raising the limit; the Stripe ephemeral key and nonce binding; the card allowance `approve` (spender pinned to `BRIDGE_CARDS_SPENDER`, verified from the `Approval` log); card ownership checks on controls and disputes.
- CSP (including the Stripe script and frame sources), security headers, Turnstile verification, abuse controls, API error behavior.

## Required tests

- Horizontal and vertical authorization; forged Privy tokens.
- Forged or expired Access tokens, tokens for another Access application, and direct calls to `/api/ops/*` that skip the operations Worker.
- Transaction-policy bypass, altered calldata, quote tampering, stale quote reuse, hash replay across actions, spoofed events in an unrelated operation.
- Webhook timing/replay, queue poison messages, unsupported asset/network paths, sensitive log leakage, rollback/schema mismatch.

## Exit standard

- No unresolved Critical or High finding. Retest every fixed Critical/High issue.
- Medium findings need an owner, deadline, compensating control, and launch decision.
- The reviewer gets the architecture, threat model, fund-flow map, API schema, migrations, deployment configuration, and a dedicated non-production test account. Never production secrets or customer recovery material.
