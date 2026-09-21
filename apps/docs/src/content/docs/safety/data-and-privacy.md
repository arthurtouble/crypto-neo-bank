---
title: Data and privacy
description: What Aurel stores, what stays with providers or chains, and why each category exists.
---

Aurel minimizes authoritative financial data. It does not pretend that operating a secure product requires no data at all.

## Data categories

| Category | Primary source | Aurel treatment |
| --- | --- | --- |
| Balances and protocol positions | Chain or provider | Read or cache for the interface; rebuildable from the authoritative source |
| Customer identity | Privy | Store the verified provider subject needed to protect customer records |
| Wallet references | Wallet and chain | Store public addresses and network context; never an Aurel private key |
| Security preferences | Customer instruction | Retain because controls must survive sessions and remain auditable |
| Transaction intents and events | Aurel plus chain/provider evidence | Retain policy results, states, hashes, and receipt checks |
| Future KYC records | Regulated provider | Avoid storing identity documents; consume the minimum status needed for access |
| Support and complaints | Aurel | Retain enough context to investigate and respond |
| Consent and disclosures | Aurel | Record which material version and action were shown or accepted |
| Product analytics | Aurel | Accept only allowlisted event names; never use analytics as a balance source |
| Provider webhook receipts | Provider and Aurel | Retain idempotently for retry, reconciliation, and incident evidence |

## Public-chain privacy

Public blockchain addresses and transactions are visible to anyone. Hiding a balance in the Aurel interface is a local display preference; it does not make onchain activity private.

Connecting identity, wallet addresses, transaction patterns, device information, and support records can reveal more than any single item. Aurel should limit access and collection even when some underlying data is public.

## Identity documents

Future regulated providers may collect identity, sanctions, source-of-funds, and other onboarding information. The intended architecture keeps the original documents with the provider and stores only the references or eligibility state Aurel needs.

The final integration and contracts determine the exact allocation. Aurel remains responsible for accurately explaining who receives the data and why.

## Retention

Different records need different retention periods. Security evidence and complaint records may need to remain longer than product analytics. Data should not be kept indefinitely merely because storage is inexpensive.

Before broad launch, Aurel must finalize a jurisdiction-specific retention schedule, deletion process, legal-hold procedure, and customer-rights workflow.

## Logs and analytics

Logs support reliability and incident investigation. They should avoid secrets, wallet signing material, full identity documents, and unnecessary transaction context. External log export requires documented access and retention controls.

Product analytics should answer bounded questions such as whether customers finish onboarding or encounter an error. Event names are allowlisted and rate limited. Analytics does not determine account balances or transaction settlement.

## Customer rights

The [Privacy notice](/legal/privacy-notice/) explains the current draft legal framework, data categories, purposes, recipients, retention, international transfers, and customer rights. Entity details, governing law, and privacy contacts must be finalized before live customer onboarding.

