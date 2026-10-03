---
title: Aura launch readiness
description: The release gates Aura must pass, with evidence, before serving customers with real financial actions.
---

No production launch is approved. `main` deploys only to the dev Worker. The ordered steps and owner go-aheads are in [production launch](../operations/production-launch.md), and `pnpm production:check` lists what the production Worker configuration lacks. What is built is in [build status](build-status.md). A capability shown in the app is not a live feature.

## Release gates

Record the evidence for each gate here, or link it, before the launch step that needs it.

1. **Scope and claims:** the contracting entity, product eligibility by country, terms, privacy, risk and product disclosures, complaints, retention, and marketing claims are confirmed. Provider KYC does not establish availability for every Aura product in every country.
2. **Provider programs:** each launched program has approved production access, defined compliance and support responsibility, tested webhooks and reconciliation, and a named escalation contact. Card payments on a public Aura tag need a separate acquiring or payment-link provider.
3. **Money and security:** an independent review closes critical and high findings ([scope](../security/external-security-review-scope.md)). Every released action kind has exact prepared calls, one customer signature, verification from chain evidence, audit evidence, and a tested feature switch.
4. **Infrastructure:** a custom HTTPS domain, production Privy origin, Privy TEE execution, gas sponsorship, and MFA, Intercom (Messenger security with JWT enforced, Fin data connector token, production app, and a support email on Aura's domain for people who can't sign in or when chat is down), Cloudflare edge controls and Access ([edge security activation](../operations/edge-security-activation.md)), secrets, D1 migration and backup, logs, alert routing (destination, receiver, quiet hours, escalation, and test date), and the restore runbook.
5. **Operations:** primary and backup incident owners, provider escalation paths, support coverage, out-of-band customer communication, dispute handling, fraud and sanctions handoff, and rollback or forward-fix procedures, staffed and exercised ([incident response](../operations/incident-response-plan.md)).
6. **Acceptance:** desktop and mobile flows, five uncoached customer journeys, controlled funded movements on every published route, delayed or failed settlement recovery, and a post-release smoke pass ([acceptance plan](../operations/acceptance-test-plan.md)). Financial switches stay off until their feature passes this gate.
