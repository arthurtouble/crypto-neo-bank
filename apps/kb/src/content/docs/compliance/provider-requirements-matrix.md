---
title: Regulated provider requirements matrix
description: Comparative functional, compliance, operational, and commercial provider requirements.
---

Use this matrix for Bridge, Rain and any replacement. Scores remain blank until supported by a contract, current product documentation or a written provider response. A polished demo is not evidence of program approval.

Scoring: `0` unavailable, `1` material gap, `2` workable with limitations, `3` strong fit. Weight is out of 100.

| Requirement | Weight | Bridge evidence / score | Rain evidence / score | Required written answer |
|---|---:|---|---|---|
| Aurel use case and customer ownership accepted | 10 | Pending | Pending | Who contracts with the end customer for each service? |
| Approved countries and excluded persons | 10 | Pending | Pending | Country-by-country individual and entity matrix |
| KYC, KYB, sanctions and EDD workflow | 9 | Pending | Pending | Decision owner, retries, manual review, SOF/SOW triggers |
| Fiat accounts and safeguarding model | 9 | Pending | Pending | Legal account holder, bank, insurance language, insolvency treatment |
| Stablecoin conversion and supported networks | 8 | Pending | Pending | Assets, chains, liquidity source, spread, settlement and reversals |
| ACH/wire/local rails coverage | 7 | Pending | Pending | Limits, cutoffs, returns, recalls and beneficiary validation |
| Card program | 8 | Pending | Pending | Issuer, regions, wallet support, funding, auth, clearing and disputes |
| API, sandbox and deterministic fixtures | 5 | Pending | Pending | Coverage parity, test identities, failure and review simulation |
| Signed events and idempotency | 6 | Pending | Pending | Signing/rotation, replay window, retry policy and event ordering |
| Reconciliation and reporting | 7 | Pending | Pending | Intraday/daily exports, canonical IDs and correction process |
| Fraud and transaction monitoring | 5 | Pending | Pending | Rule owner, alerts, freezes, escalation and Aurel obligations |
| Complaints, disputes and chargebacks | 4 | Pending | Pending | Customer contact, evidence exchange, deadlines and loss allocation |
| Data residency, subprocessors and deletion | 3 | Pending | Pending | DPA, regions, retention, portability and incident notice |
| Security and availability commitments | 3 | Pending | Pending | SOC reports, pen test, SLA, RTO/RPO and status channel |
| Support and incident escalation | 3 | Pending | Pending | Named contacts and severity response times |
| Commercial model | 6 | Pending | Pending | Every setup, minimum, unit, reserve and termination fee |

## Mandatory gates

A provider is not selectable unless it confirms the use case, customer relationship, launch countries, asset/network scope, compliance allocation, safeguarding model, event/reconciliation design, incident channel and full pricing in writing. Contract language must survive comparison with the API documentation.

## Decision method

1. Aurel sends the same diligence pack and volume scenarios to both providers.
2. Product and engineering validate sandbox parity and failure handling.
3. Counsel reviews entity, customer contract, licensing reliance, countries, disclosures and data roles.
4. Operations runs onboarding, transfer, return, freeze, dispute and reconciliation tabletop tests.
5. Finance models unit economics using contracted prices, not sales estimates.
6. The accountable founder records the decision and rejected trade-offs here.

## Current recommendation

Run a two-provider diligence process and select one primary provider for the beta. Do not integrate both production programs simultaneously: dual integration increases reconciliation, compliance and support surface before product-market evidence exists. Keep the existing adapter boundary so a second provider can be introduced for geographic or capability redundancy later.
