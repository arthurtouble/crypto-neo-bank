---
title: External security review scope
description: Required scope and evidence for independent security assessment.
---

## In scope

- Privy token verification, subject isolation, embedded wallet binding, passkey requirement, relay signature checks, and recovery/export presentation.
- Action preparation (`POST /api/actions`), call fingerprinting, hash binding, expiry, and status transitions.
- The verifier: operation identity (decoded calls equal prepared calls), finality, expected events, and cross-chain delivery.
- LI.FI quotes: server-held storage, Diamond pinning, price-impact and slippage bounds, and batched ERC-20 approvals.
- Account lock, daily limit, saved-recipients-only mode, recipient cooling, valuation, and feature switches on every action.
- Operator authorization, Cloudflare Access activation boundary and feature kill switches.
- Per-provider webhook verification (Bridge RSA, Privy Svix, Stripe HMAC-SHA256), customer resolution through `provider_customer_links` (Stripe card events through `card_account_projections`), replay prevention, queue retries, dead-letter processing and reconciliation.
- D1 migrations, evidence integrity, backup/export/restore, log minimization and incident procedures.
- Cards: passkey step-up for card details, unfreezing, and raising the limit; the Stripe ephemeral key and nonce binding; the card allowance `approve` (spender pinned to `BRIDGE_CARDS_SPENDER`, verified from the `Approval` log); card ownership checks on controls and disputes.
- CSP (including the Stripe script and frame sources), security headers, Turnstile verification, abuse controls and API error behavior.

## Required tests

Test horizontal and vertical authorization, forged Privy/Access headers, transaction-policy bypass, altered calldata, quote tampering, stale quote reuse, hash replay across actions, spoofed events in an unrelated operation, webhook timing/replay, queue poison messages, unsupported asset/network paths, sensitive log leakage and rollback/schema mismatch.

## Exit standard

No unresolved Critical or High finding. Medium findings need an owner, deadline, compensating control and launch decision. Retest every fixed Critical/High issue. The reviewer receives architecture, threat model, fund-flow map, API schema, migrations, deployment configuration and a dedicated non-production test account; never production secrets or customer recovery material.
