---
title: Fund flow and provider data map
description: What Aura stores and doesn't store for each system that moves or holds customer money.
---

How money moves is in [money actions](money-actions.md) (send, swaps and cross-chain moves, Earn), [accounts and custody](accounts-and-custody.md) (signing and relay), and [provider projections](provider-projections.md) (Bridge and Stripe events). Who is authoritative for what is in [architecture](architecture.md#systems-of-record).

## Data minimization

| System | Aura stores | Aura does not store |
|---|---|---|
| Privy | Verified subject, embedded wallet address, Privy relay reference for each action | Private key, recovery secret, one-time code |
| Chain and protocols (Aave, Morpho) | Address, chain, asset, transaction hash, source block, observation time | A proprietary balance ledger |
| LI.FI | Server-held quote, route status, and transaction evidence | A claim that source confirmation equals destination delivery |
| Bridge (bank, card approval) | Customer and resource references, approval status, payout status, reconciliation evidence | Original KYC documents, unless a contract and legal need explicitly require them |
| Stripe Issuing (cards) | Which card is the customer's, and card payments as Stripe reported them | Card number, expiry, or security code |

No regulated flow is active until signed contracts and the country matrix approve it. The contract must define account holder, safeguarding, conversion counterparty, settlement, reversals, freezes, and complaints.
