---
title: Data and privacy
description: What Aura stores, what stays with partners or on the blockchain, and why.
---

Aura keeps as little financial data as it can, because your money lives on the blockchain, not with us. Running a safe service still means keeping some records. This page explains which ones and why. For the formal version, see the [privacy notice](/legal/privacy-notice/).

## What we keep

| Data | Where it really lives | What Aura does with it |
| --- | --- | --- |
| Balances and Earn positions | The blockchain | Reads them and may keep a copy. Can always be rebuilt |
| Who you are | Privy | Keeps the verified account reference it needs to protect your records |
| Your wallet address | The blockchain | Keeps your account address and network. Never a private key |
| Your security settings | Your choices | Keeps them so they last between sessions, with a record of changes |
| Money movements | Aura, plus blockchain evidence | Keeps the transaction Aura prepared, its status, hashes, and checks |
| Identity verification, once live | Our partner | Doesn't keep your documents. Uses only the status it needs |
| Support and complaints | Aura | Keeps enough to investigate and reply |
| Consent and documents you accepted | Aura | Records which version you saw or accepted, and when |
| Notification choices | Your choices | Keeps them until you change them |
| Notices sent to you | Aura | Keeps each notice and whether it was delivered, and where to send browser notifications until you turn them off |
| Card, reward, and wallet-rule records, once live | The card issuer (Stripe), reward partner, or wallet provider | Keeps the status the partner reports, with its source and time |
| Product analytics | Aura | Accepts only a fixed list of events. Never used for balances |
| Partner updates | The partner and Aura | Keeps them so we can retry, reconcile, and investigate |

## Blockchains are public

Anyone can see blockchain addresses and transactions. Hiding your balance in Aura only hides it on your screen. It doesn't make your activity private.

Put together, your identity, addresses, transaction patterns, device, and support history can reveal more than any one of them. So we limit who can see and collect this data, even when some of it is already public.

## Identity documents

When bank transfers or cards go live, our partners may collect identity, sanctions, source-of-funds, and other onboarding information. We plan for the partner to keep the original documents, with Aura storing only the references or status it needs.

The final contracts will set exactly who holds what. Whatever they say, we'll tell you clearly who receives your data and why.

## How long we keep things

Different records need different retention periods. Security and complaint records may need to be kept longer than analytics. We don't keep data forever just because storage is cheap.

Every table in Aura that holds your data is labeled as erasable or kept, with a reason. An automated test fails if a new one is missing a label.

- **Erasable:** preferences, analytics, your public Aura tag, and history we can rebuild from partners and the blockchain.
- **Kept as evidence:** money movements, security settings, consent, and support chats (held in Intercom).

Retention periods for each country, and a process for legal holds, will be set before launch.

## Logs and analytics

Logs help us keep Aura reliable and investigate incidents. They should never contain secrets, signing material, identity documents, or transaction details we don't need.

Analytics answer narrow questions, like whether people finish setup or hit an error. Only a fixed list of events is accepted, and they're rate limited. Analytics never decide balances or settlement.

## Your choices

In **Settings** you can:

- download everything Aura holds about your account, straight away (Your data and account); and
- turn product-update emails on or off (Notifications → Product news).

To close your account, contact support once it holds no funds. Aura keeps your transaction, security, and consent records.

The [privacy notice](/legal/privacy-notice/) covers data categories, purposes, recipients, retention, international transfers, and your rights. Our entity details, governing law, and privacy contacts will be finalized before launch.
