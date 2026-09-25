---
title: Activity and transaction states
description: What submitted, on its way, complete, failed, and not confirmed mean.
---

Activity is an evidence trail, not just a list of successful payments. Aura records what it observes so you can tell a request from a settled result. A quote alone does not create an Activity item.

## How a money movement works

1. **Request.** You choose the action, amount, network, and recipient or position.
2. **Prepare.** Aura's server checks the feature, your account lock, limits, and recipient settings, then builds the exact transaction.
3. **Sign.** Your wallet shows the request. Any approval and the action are signed together, as one operation. You can cancel.
4. **Submit.** Your wallet reports the transaction hash to Aura.
5. **Verify.** Aura reads the chain itself and checks the result.

## State meanings

| State | Meaning |
| --- | --- |
| **Blocked** | Your controls or a feature switch stopped the request. Nothing was sent to your wallet. |
| **Submitted** | You signed and a transaction hash exists. Aura is still checking. |
| **On its way** | A cross-network move left the first network. Delivery is not yet confirmed. |
| **Complete** | The operation matches what you reviewed, the network finalized it, and the expected transfer or deposit appeared. Cross-network moves also need delivery. |
| **Failed** | The network rejected it, the route failed, or the result didn't match what you reviewed. Activity shows the reason. |
| **Not confirmed** | Aura didn't receive a transaction hash in time. If you confirmed it in your wallet, check your wallet activity. This is not shown as failed. |

A transaction hash proves only that a request was submitted. Aura compares the signed operation, its calls, and its effects with what it prepared before marking it complete. A receipt alone is not enough. Aura keeps checking until the network's finality threshold is reached, because a chain reorganization can undo earlier evidence.

Open an item in Activity to see its timeline. Entries come from an append-only record; the chain or provider still decides settlement.

For Aave, Activity can also read protocol history from an external source. The source stays visible on each record, so an Aura entry is never presented as a protocol observation. External history is not proof that Aura started or verified the action.

## Exports and coverage

The Export dialog describes the records in the current filtered view before creating a file. It shows how many rows have network receipts, how many came directly from the protocol source, and how many carry a source-reported or action-time USD estimate.

- **Activity CSV** includes dates, amounts, statuses, sources and transaction hashes.
- **Tax Support CSV** adds evidence authority and explicit placeholders for tax classification and cost basis.

Aura does not infer a purchase price, disposal method, jurisdictional tax treatment, gain or loss when the evidence is incomplete. Missing cost basis stays **Unavailable**, and tax classification stays **Review required**. The file is supporting evidence, not a bank statement, tax return or tax advice.

Aave activity is paginated and can be temporarily unavailable. The export warns when the current protocol response is partial or missing instead of silently presenting the file as complete.

## Cross-network delivery

For a cross-network swap, the first network confirming does not prove delivery. Activity shows the first transaction and delivery separately. Aura marks it complete only after LI.FI reports delivery and Aura sees at least the minimum amount arrive. If less arrives, a refund is reported, or delivery fails, Activity says so.

A movement unresolved for more than 15 minutes is flagged for operations. That starts an investigation; it does not mean the movement failed.

## Replaced and repeated transactions

A wallet may replace a pending transaction with another transaction using the same nonce. Network explorers may show the original as dropped or replaced. Aura should preserve the known history rather than rewriting it as though only one request existed.

Before retrying any uncertain transaction, check the wallet activity and authoritative source. Repeating a transfer can produce two valid payments.

## What Aura cannot reverse

Public-chain transactions are generally irreversible after settlement. Aura cannot recall funds sent to the wrong address, undo a protocol liquidation, or cancel a confirmed route. Product controls are designed to reduce preventable mistakes before signing.
