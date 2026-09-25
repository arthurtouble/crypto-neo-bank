---
title: Daily money flows
description: Recipients, activity receipts, exports, and their authority boundaries.
---

Aura uses **Deposit**, **Send**, **Swap**, **Earn**, and **Invest**. Networks, providers, and protocols appear when the customer must make a material choice.

## Recipients

The Recipients directory combines two sources without weakening their controls:

- Wallet recipients come from the security address book. A new address inherits the configured cooling period and cannot be presented as verified until that period ends.
- Bank recipients are projections of beneficiaries created and verified by an activated banking provider. Aura does not invent a verified bank beneficiary.
- Recent wallet destinations may be shown for convenience, but remain visibly unverified until saved and matured through the address book.

Saving a name does not authorize a transfer. Every transfer still passes authentication, the feature switch, the customer's controls, and the customer's wallet or provider confirmation.

## Activity and receipts

Activity is a rebuildable view of Aura actions and their observed chain or provider evidence. Each row can show:

- customer-facing description and category;
- status;
- amount and asset when present;
- destination summary;
- Aura reference and public transaction link when recorded.

The CSV export is an **Aura activity record**, not a bank statement, tax statement, or complete wallet history. Provider statements and blockchain records remain authoritative.

## Status language

| Aura display | Evidence |
|---|---|
| Submitted | A transaction hash was reported; verification is not finished. |
| On its way | The source operation is confirmed; cross-chain delivery is not yet observed. |
| Complete | Operation identity, finality, and expected effects (and delivery, for cross-chain) were verified. |
| Failed | The chain, route, or verifier reported failure, with a reason. |
| Not confirmed | No hash arrived before the action expired. The customer is told to check wallet activity; it is never shown as failed. |

Source confirmation is never presented as cross-network destination delivery. Initial provider acceptance is never presented as completed bank settlement.
