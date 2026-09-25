---
title: External security review scope
description: Required scope and evidence for independent security assessment.
---

## In scope

- Privy token verification, subject isolation, smart-wallet binding, and recovery/export presentation.
- Action preparation (`POST /api/actions`), call fingerprinting, hash binding, expiry, and status transitions.
- The verifier: operation identity (decoded calls equal prepared calls), finality, expected events, and cross-chain delivery.
- LI.FI quotes: server-held storage, Diamond pinning, price-impact and slippage bounds, and batched ERC-20 approvals.
- Account lock, daily limit, saved-recipients-only mode, recipient cooling, valuation, and feature switches on every action.
- Operator authorization, Cloudflare Access activation boundary and feature kill switches.
- Provider webhook authentication, replay prevention, queue retries, dead-letter processing and reconciliation.
- D1 migrations, evidence integrity, backup/export/restore, log minimization and incident procedures.
- CSP, security headers, Turnstile verification, abuse controls and API error behavior.

## Required tests

Test horizontal and vertical authorization, forged Privy/Access headers, transaction-policy bypass, altered calldata, quote tampering, stale quote reuse, hash replay across actions, spoofed events in an unrelated operation, webhook timing/replay, queue poison messages, unsupported asset/network paths, sensitive log leakage and rollback/schema mismatch.

## Exit standard

No unresolved Critical or High finding. Medium findings need an owner, deadline, compensating control and launch decision. Retest every fixed Critical/High issue. The reviewer receives architecture, threat model, fund-flow map, API schema, migrations, deployment configuration and a dedicated non-production test account; never production secrets or customer recovery material.
