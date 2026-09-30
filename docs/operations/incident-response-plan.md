---
title: Incident response plan
description: Roles, severities, response procedures, communications, and recovery evidence.
---

## Severity

- **Critical:** unauthorized signing or asset movement, authentication boundary failure, material data exposure, sanctions instruction, or widespread inability to determine settlement.
- **High:** repeated transaction mismatch, provider event loss, critical dependency unavailable without safe degradation, or funds-at-risk support case.
- **Medium:** contained customer-impacting defect with a workaround or delayed non-authoritative data.
- **Low:** cosmetic or operational issue with no financial, security, or legal impact.

## First 15 minutes

1. Name an incident lead and evidence recorder.
2. Stop the smallest affected path with its server-side feature switch; use the global account or provider control only when scope is uncertain.
3. Preserve Worker version, trace IDs, transaction hashes, event IDs, queue state and timestamps.
4. Confirm the authoritative state from the chain or provider. Never infer settlement from Aurel state.
5. For Critical or High incidents, notify the accountable founder and backup, and the provider's emergency channel when its system is involved.
6. Publish an investigating notice when customers need to change behavior. Never promise a reversal or an unknown recovery time.

## Investigation and recovery

- Reproduce with read-only evidence where possible.
- Separate code, configuration, dependency, customer-device and provider causes.
- Never bypass signature, authentication, eligibility, or transaction-policy controls to restore service.
- Reconcile every affected instruction before reopening the path.
- Restore application evidence with `scripts/recovery-drill.sh` as the tested pattern; chains and providers stay the balance authority.
- Rotate a secret only through the approved Cloudflare secret workflow and record the affected Worker version.

## Closure

An incident closes only when impact is bounded, affected records are reconciled, customer and provider notices are complete, the feature switch decision is recorded, and corrective actions have owners and dates. Critical and High incidents need a written review within five business days.

## Required contacts before launch

Record a primary and backup for product and security, operations and support, legal and compliance, and each production provider. AI agents may help collect evidence and draft; they are never the incident lead or accountable contact.
