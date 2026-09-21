# External security review scope

## In scope

- Privy token verification, subject isolation, recovery/export presentation and passkey step-up.
- Transaction intent creation, fingerprinting, policy, cooling, expiry, simulation, wallet handoff and state transitions.
- Allowlisted networks, tokens, protocol contracts, route targets and ERC-20 approvals.
- Beta invitation hashing, redemption concurrency, country gating, suspension and transaction caps.
- Operator authorization, Cloudflare Access activation boundary and feature kill switches.
- Provider webhook authentication, replay prevention, queue retries, dead-letter processing and reconciliation.
- D1 migrations, evidence integrity, backup/export/restore, log minimization and incident procedures.
- CSP, security headers, Turnstile verification, abuse controls and API error behavior.
- AI concierge isolation from signing, transactions, administration and individualized advice.

## Required tests

Test horizontal and vertical authorization, forged Privy/Access headers, duplicate invite redemption, transaction-policy bypass, altered calldata, quote tampering, stale review reuse, webhook timing/replay, queue poison messages, unsupported asset/network paths, prompt injection, sensitive log leakage and rollback/schema mismatch.

## Exit standard

No unresolved Critical or High finding. Medium findings need an owner, deadline, compensating control and launch decision. Retest every fixed Critical/High issue. The reviewer receives architecture, threat model, fund-flow map, API schema, migrations, deployment configuration and a dedicated non-production test account; never production secrets or customer recovery material.

