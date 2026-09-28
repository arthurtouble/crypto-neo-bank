---
title: Daily money flows
description: Recipients, activity receipts, exports, and their authority boundaries.
---

Aura uses **Deposit**, **Send**, **Swap**, and **Earn**. Stocks and gold are bought in Swap. Networks, providers, and protocols appear when the customer must make a material choice.

## Recipients

The Recipients directory combines two sources without weakening their controls:

- Wallet recipients come from the security address book. A new address inherits the configured cooling period and cannot be presented as verified until that period ends.
- Bank recipients are projections of beneficiaries created and verified by an activated banking provider. Aura does not invent a verified bank beneficiary.
- Recent wallet destinations may be shown for convenience, but remain visibly unverified until saved and matured through the address book.

Saving a name does not authorize a transfer. Every transfer still passes authentication, the feature switch, the customer's controls, and the customer's wallet or provider confirmation.

## Activity and receipts

Transactions is a rebuildable view of Aura actions, money received without an action, and Aave history. Each row shows a description (Sent, Received, Swapped, Moved between networks, Added to Earn, Withdrawn from Earn), status, amount and asset (both sides for a swap), network, who it was with, and a link to the network. Aura actions also show their journey.

Exports (the list, a tax-support preview, and a monthly statement) are records of this activity, not bank statements, tax statements, or complete wallet histories. Provider statements and blockchain records remain authoritative.

## Status language

| Aura display | Evidence |
|---|---|
| Pending | Submitted and not yet included, or a cross-chain move waiting for delivery. |
| Completed | Included, with operation identity and expected effects (and delivery, for cross-chain) verified. Money received: in a block. Marked final once the block is final (about 20 minutes on Base). |
| Failed | The chain, route, or verifier reported failure, with a reason. |
| Not confirmed | The action wasn't signed and submitted before it expired. Never shown as failed. |

Source confirmation is never presented as cross-network destination delivery. Initial provider acceptance is never presented as completed bank settlement.
