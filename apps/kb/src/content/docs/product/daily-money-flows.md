---
title: Daily money flows
description: Recipients, activity receipts, exports, and their authority boundaries.
---

Aura uses **Deposit**, **Send**, **Swap**, **Earn**, and **Borrow**. Networks, providers, and protocols appear when the customer must make a material choice.

## Recipients

The Recipients directory combines two sources without weakening their controls:

- Wallet recipients come from the security address book. A new address inherits the configured cooling period and cannot be presented as verified until that period ends.
- Bank recipients are projections of beneficiaries created and verified by an activated banking provider. Aura does not invent a verified bank beneficiary.
- Recent wallet destinations may be shown for convenience, but remain visibly unverified until saved and matured through the address book.

Saving a name does not authorize a transfer. Every transfer still passes current authentication, feature access, security policy, simulation where available, and the customer’s wallet or provider confirmation.

## Activity and receipts

Activity is a rebuildable view of Aura-created transaction intents and their observed chain or provider evidence. Each row can show:

- customer-facing description and category;
- prepared, pending, completed, failed, or cancelled state;
- amount and asset when present;
- destination summary;
- Aura reference and public transaction link when recorded.

The CSV export is an **Aura activity record**, not a bank statement, tax statement, or complete wallet history. Provider statements and blockchain records remain authoritative.

## Status language

| Aura display | Evidence |
|---|---|
| Awaiting approval | A reviewed or cooling intent exists; no submission is claimed. |
| Pending | A wallet or provider submission reference exists but terminal settlement is not yet observed. |
| Completed | The authoritative chain receipt or provider state was reconciled as terminal success. |
| Failed | The policy, provider, route, or chain reported failure. |
| Cancelled | The customer stopped the action before submission or the provider confirmed cancellation. |

Source confirmation is never presented as cross-network destination delivery. Initial provider acceptance is never presented as completed bank settlement.
