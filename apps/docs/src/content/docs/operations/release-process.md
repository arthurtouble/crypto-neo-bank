---
title: Release process
description: How changes move from development to production and how Aurel limits release risk.
---

Aurel has two environments: development and production. There is no long-lived staging environment. Production safety comes from automated checks, versioned releases, isolated data tests, canary verification, and fast rollback—not from an unused third environment.

## Development

Local development uses emulated or development Cloudflare services and provider-safe test paths where available. Mainnet reads may be used for realism, but development must not imply that a real customer action is free of risk.

Secrets stay outside source control. Public browser configuration is limited to values that are designed to be public, such as an application identifier or Turnstile site key.

## Required checks

A production candidate should pass:

- lint and static type checking;
- unit tests for policy and financial-state invariants;
- production builds for product and documentation;
- browser tests for critical desktop and mobile paths;
- accessibility assertions;
- dependency and code security analysis;
- read-only mainnet integration checks;
- an isolated D1 migration and recovery exercise when schema changes are involved.

Passing tests reduces known risk. It is not proof that a financial integration is safe.

## Versioned deployment

Cloudflare Workers deployments create identifiable versions. A release should record the source commit, Worker version, migration set, smoke-test result, and operator.

New code is checked on the production endpoint before the release is considered complete. Where a change has meaningful runtime risk, traffic can be introduced gradually and rolled back to the prior Worker version.

## Database changes

D1 migrations are forward-only and reviewed separately from application code. A release must remain safe if application deployment and schema migration do not complete at the same moment.

The action-passkey foundation is an explicit migration-first release: apply and verify migration `0024` before deploying a build that reads `policy_version`. Keep passkey enrollment and transaction-specific approval disabled until the final domain, recovery path, and security review are complete.

Destructive cleanup should follow a compatibility period. A field is not removed in the same release that stops writing it unless the migration and rollback plan explicitly support that choice.

## Provider changes

A provider API change can be as consequential as an application release. Contract addresses, supported networks, webhook schemas, signature rules, and eligibility behavior require explicit review and versioning.

The product fails closed when a provider response no longer matches the validated schema or expected transaction plan.

## Documentation in the release

Material changes to fees, supported assets, eligibility, transaction states, risk, privacy, or provider responsibility require documentation and disclosure updates in the same release. The documentation date should reflect substantive review, not an automated build timestamp.

## Rollback limits

Application code can be rolled back. A signed transaction, completed provider action, sent notification, or applied database migration may not be reversible. Release planning must treat external side effects separately from code deployment.

## Remaining edge launch work

Before broad customer launch, Aurel still needs a custom production domain, finalized WAF and rate-limit policy, protected operations access, durable external log retention, formal alert routing, and tested on-call procedures. Current Worker deployment is a production-quality preview, not a declaration that every launch control is complete.
