---
title: Incident response plan
description: Roles, severities, response procedures, communications, and recovery evidence.
---

## Severity

- **Critical:** unauthorized signing or asset movement, authentication boundary failure, material data exposure, sanctions instruction, or widespread inability to determine settlement.
- **High:** repeated transaction mismatch, provider event loss, critical dependency unavailable without safe degradation, or funds-at-risk support case.
- **Medium:** contained customer-impacting defect with a workaround or delayed non-authoritative data.
- **Low:** cosmetic or operational issue without financial, security or legal impact.

## First 15 minutes

1. Name an incident lead and evidence recorder.
2. Stop the smallest affected path with its server-side feature flag; use the global account/provider control only when scope is uncertain.
3. Preserve Worker version, trace IDs, transaction hashes, event IDs, queue state and timestamps.
4. Confirm what is authoritative from the chain or provider. Do not infer settlement from Aurel state.
5. For Critical/High incidents, notify the accountable founder and backup; contact the provider emergency channel when its system is involved.
6. Publish an investigating notice when customers need to change behavior. Never promise reversal or a recovery time that is not known.

## Investigation and recovery

- Reproduce with read-only evidence where possible.
- Separate code, configuration, dependency, customer-device and provider causes.
- Do not bypass signature, authentication, eligibility or transaction-policy controls to restore service.
- Reconcile every affected instruction before reopening the path.
- Restore application evidence using `scripts/recovery-drill.sh` as the tested pattern; public chains/providers remain balance authority.
- Rotate a secret only through the approved Cloudflare secret workflow and record the affected Worker version.

## Closure

An incident closes only when impact is bounded, affected records are reconciled, customer/provider notices are complete, the feature flag decision is recorded, and corrective actions have owners and dates. Critical and High incidents require a written review within five business days.

## Required contacts before beta expansion

Record a primary and backup for product/security, operations/support, legal/compliance and each production provider. AI agents may support evidence collection and drafting; they are not the incident lead or accountable contact.
