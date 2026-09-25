---
title: Data retention and deletion schedule
description: Internal retention, deletion, and recovery rules by data category.
---

Status: pre-launch operating baseline. Counsel and each regulated provider must approve the final periods before customer onboarding. Aurel does not retain data merely because storage is available.

| Record | Purpose | Baseline period | Authority and deletion rule |
|---|---|---:|---|
| Wallet addresses and provider references | Connect the customer to authoritative systems | Active relationship + 7 years | Delete or irreversibly detach after legal, complaint, fraud and tax holds expire |
| Transaction intents, policy results and state events | Explain and investigate customer instructions | 7 years | Preserve hashes and decision evidence; never store signing secrets |
| Consent and disclosure evidence | Prove the version and action accepted | 7 years after relationship | Legal hold overrides scheduled deletion |
| Security preferences and destination book | Enforce customer controls | Active relationship + 90 days | Delete after closure unless linked to an incident or complaint |
| Provider webhook receipts | Retry, reconcile and investigate events | 2 years | Retain identifiers and hashes; minimize raw payload data |
| Support cases and complaints | Respond and evidence handling | 7 years | Redact accidental secrets immediately; provider-specific rules may be longer |
| Product analytics | Improve activation and reliability | 13 months raw; 36 months aggregated | Remove direct subject reference from retained aggregates |
| Abuse and rate-limit windows | Protect the service | 24 hours after window | Automatically delete expired counters |
| Application logs and traces | Reliability and security investigation | 30 days hot; up to 1 year security archive | No keys, tokens, recovery material or full identity documents |
| Customer feedback | Product research | 24 months | Remove subject link earlier when no longer needed |
| KYC source documents | Regulated onboarding | Not stored by Aurel by design | Remain with the contracted regulated provider |
| Incident records | Security, customer impact and remediation | 7 years | Public notices remain; internal evidence follows access and legal-hold rules |

## Operating rules

1. A deletion job must use an approved record category, cutoff and legal-hold check.
2. Backups inherit the same retention intent and expire through the backup lifecycle rather than ad hoc editing.
3. A customer-rights request is logged, identity-verified, mapped across Aurel and providers, and answered within the applicable legal period.
4. Public-chain data cannot be erased by Aurel. Aurel can remove its own association and explain the remaining public record.
5. Original KYC documents, card data, seed phrases, private keys and one-time codes are prohibited from D1, logs, support and analytics.
