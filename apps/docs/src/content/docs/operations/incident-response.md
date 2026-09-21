---
title: Incident response
description: Severity, containment, evidence, customer updates, recovery, and closure.
---

An incident is managed around customer impact and authoritative evidence. Restoring a green interface is not enough if settlement or policy history remains uncertain.

## Severity

- **Critical:** unauthorized signing or movement, authentication-boundary failure, material data exposure, sanctions instruction, or widespread inability to determine settlement.
- **High:** repeated transaction mismatch, lost provider event, unsafe dependency failure, or funds-at-risk support case.
- **Medium:** contained customer impact with a safe workaround.
- **Low:** no financial, security, privacy, or legal impact.

## Contain

Name an incident lead and evidence recorder. Disable the smallest affected path using its server-side feature flag. Preserve the Worker version, trace IDs, transaction hashes, route references, provider events, queue state, and times.

Do not disable authentication, signatures, eligibility, simulation, or transaction policy to restore traffic.

## Establish authority

Read the chain, protocol, or provider that owns the disputed state. An Aurel projection, webhook delivery, or source-chain route receipt may be incomplete. Separate confirmed fact from working hypothesis in every update.

## Communicate

Publish a status update when customers need to avoid repeating an action or when a material feature is unavailable. State the affected feature, start time, safe customer action, unaffected areas, and next meaningful update. Never promise reversal or a recovery time that is not known.

## Recover and reconcile

Repair the cause, restore retained evidence where needed, replay only idempotent events, and reconcile every affected instruction. Reopen gradually and monitor the same signals that detected the issue.

## Close

Critical and High incidents require a written review within five business days. Record impact, timeline, root cause, control performance, customer/provider communication, corrective actions, owners, and deadlines.

AI can help collect evidence and draft updates. It cannot be the accountable incident lead.

