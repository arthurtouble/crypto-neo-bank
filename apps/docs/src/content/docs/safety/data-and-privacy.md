---
title: Data and privacy
description: What Aura stores, what stays with providers or chains, and why each category exists.
---

Aura minimizes authoritative financial data. It does not pretend that operating a secure product requires no data at all.

## Data categories

| Category | Primary source | Aura treatment |
| --- | --- | --- |
| Balances and protocol positions | Chain or provider | Read or cache for the interface; rebuildable from the authoritative source |
| Customer identity | Privy | Store the verified provider subject needed to protect customer records |
| Wallet references | Wallet and chain | Store your smart wallet address and network context; never a private key |
| Security preferences | Customer instruction | Retain because controls must survive sessions and remain auditable |
| Money movements and their checks | Aura plus chain/provider evidence | Retain the prepared transaction, status, hashes, and checks |
| Future KYC records | Regulated provider | Avoid storing identity documents; consume the minimum status needed for access |
| Support and complaints | Aura | Retain enough context to investigate and respond |
| Consent and disclosures | Aura | Record which material version and action were shown or accepted |
| Notification choices | Customer instruction | Retain until changed or deleted; applied once delivery is connected |
| Card, benefit, and wallet-rule records | Issuer, benefit provider, or wallet provider | Store the status the provider reports, with source and time; rebuildable by replaying provider events |
| Product analytics | Aura | Accept only allowlisted event names; never use analytics as a balance source |
| Provider webhook receipts | Provider and Aura | Retain idempotently for retry, reconciliation, and incident evidence |

## Public-chain privacy

Public blockchain addresses and transactions are visible to anyone. Hiding a balance in the Aura interface is a local display preference; it does not make onchain activity private.

Connecting identity, wallet addresses, transaction patterns, device information, and support records can reveal more than any single item. Aura should limit access and collection even when some underlying data is public.

## Identity documents

Future regulated providers may collect identity, sanctions, source-of-funds, and other onboarding information. The intended architecture keeps the original documents with the provider and stores only the references or eligibility state Aura needs.

The final integration and contracts determine the exact allocation. Aura remains responsible for accurately explaining who receives the data and why.

## Retention

Different records need different retention periods. Security evidence and complaint records may need to remain longer than product analytics. Data should not be kept indefinitely merely because storage is inexpensive.

Every Aura table that holds customer data is classified as erasable or retained, with a reason, and a test fails if a new table is left unclassified. Preferences, analytics, feedback, the public Aura tag, and rebuildable provider and portfolio history are erasable. Money movements, security settings, consent, and support cases are retained as evidence. Jurisdiction-specific periods and a legal-hold procedure must be set before launch.

## Logs and analytics

Logs support reliability and incident investigation. They should avoid secrets, wallet signing material, full identity documents, and unnecessary transaction context. External log export requires documented access and retention controls.

Product analytics should answer bounded questions such as whether customers finish onboarding or encounter an error. Event names are allowlisted and rate limited. Analytics does not determine account balances or transaction settlement.

## Customer rights

In Settings → Data & Privacy you can request an export of everything Aura holds about your account, request deletion of erasable data, and turn product-update emails on or off. The [Privacy notice](/legal/privacy-notice/) explains data categories, purposes, recipients, retention, international transfers, and your rights. Entity details, governing law, and privacy contacts must be finalized before launch.

