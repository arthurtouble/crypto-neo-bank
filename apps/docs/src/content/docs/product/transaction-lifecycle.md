---
title: Activity and transaction states
description: What prepared, cooling, reviewed, submitted, confirmed, failed, and cancelled mean.
---

Activity is an evidence trail, not just a list of successful payments. Aurel records the states it observes so customers and operations can distinguish a request from a settled result.

Swap currently uses LI.FI execution through the connected wallet. Its progress appears on the Swap screen while it is open; it does not appear in the Aurel Activity timeline described here.

## Standard lifecycle

1. **Request.** The customer enters the action, amount, network, destination, or protocol position.
2. **Prepare.** Aurel or the integrated protocol produces an unsigned transaction plan.
3. **Validate.** The server checks product policy, supported contracts, account controls, and required disclosures.
4. **Simulate.** Supported direct sends and the reviewed Swap route use gas estimation and a read-only execution call. Protocol screens may preview a position, but protocol signing is not currently enabled.
5. **Confirm.** The wallet presents the final transaction. The customer signs or cancels.
6. **Submit.** A transaction hash exists and the source network has received the transaction.
7. **Observe.** Aurel checks the source receipt and, where relevant, the provider or destination state.

Supported direct sends use **Review**, **Confirm**, **Submitted**, and **Complete**. Eligible accounts can also confirm the reviewed USD Coin Swap route when it is enabled. Other route previews do not reach a signing step. The progress panel can be closed after submission; the request remains visible in Activity.

## State meanings

| State | Meaning |
| --- | --- |
| **Blocked** | A policy rule rejected the request. No signing request was created. |
| **Cooling** | A new-destination or high-value waiting period is active. |
| **Reviewed** | The hold elapsed and the same instruction was revalidated. This release expires after 15 minutes. |
| **Submitted** | The customer signed and a transaction hash exists. Settlement is still pending. |
| **Confirmed** | The transaction has passed the required checks. A cross-network Swap also needs verified delivery on the destination network. |
| **Failed** | Preparation, submission, provider handling, or the source receipt failed. |
| **Cancelled** | The instruction was cancelled before settlement. |

“Submitted” and “Complete” are deliberately different. A transaction hash proves only that a request was submitted. For supported new transfers, Aurel compares the final receipt, calls, and effects with the prepared instruction before marking it complete. A receipt alone is not enough. Older records that lack this binding remain unverified even if a source receipt reports success.

States do not move arbitrarily. For example, a cooling instruction must be reviewed before submission, and a submitted instruction needs matched settlement evidence before Aurel calls it confirmed. A chain reorganization can invalidate earlier evidence, so Aurel keeps checking until the required finality threshold is reached.

Open an item in Activity to see its recorded timeline. It can include security review, completion of a security delay, network submission, and final confirmation or failure. Timeline entries come from append-only intent events; the blockchain or provider still controls settlement truth.

For Aave, Activity can also read protocol history from an external source. The source remains visible on each record so an Aurel workflow entry is never presented as if it were a protocol observation. External history is not proof that Aurel initiated or verified the action.

## Exports and coverage

The Export dialog describes the records in the current filtered view before creating a file. It shows how many rows have network receipts, how many came directly from the protocol source, and how many carry a source-reported or action-time USD estimate.

- **Activity CSV** includes dates, amounts, statuses, sources and transaction hashes.
- **Tax Support CSV** adds evidence authority and explicit placeholders for tax classification and cost basis.

Aurel does not infer a purchase price, disposal method, jurisdictional tax treatment, gain or loss when the evidence is incomplete. Missing cost basis stays **Unavailable**, and tax classification stays **Review required**. The file is supporting evidence, not a bank statement, tax return or tax advice.

Aave activity is paginated and can be temporarily unavailable. The export warns when the current protocol response is partial or missing instead of silently presenting the file as complete.

## Instruction fingerprints

A high-value action that completes its cooling period is not released as a blank approval. Aurel compares the network, asset, amount, destination, and relevant call data with the original instruction. If a material field changes, the previous review does not apply.

The reviewed state lasts 15 minutes. After that, the customer must prepare the action again. This prevents an old approval window from remaining open indefinitely.

## Simulations are estimates

Simulation can catch a likely revert and estimate gas under current state. It cannot guarantee execution at a later block. Prices, balances, allowances, contract state, network conditions, and oracle values can change before settlement.

For a protocol action, previewed health factors and rates are decision support. They are not guaranteed outcomes.

## Receipt checks

Aurel checks supported submitted transactions using source-chain JSON-RPC. The activity record can include the transaction hash, source block, receipt result, last-check time, and available route or provider reference.

For a cross-network Swap, source confirmation does not prove delivery. Activity shows the first transaction and destination delivery separately. Aurel marks the Swap complete only after it verifies both. If less than the stated minimum arrives, a refund is reported, or the evidence changes, the transfer stays under review. A quote preview is not a transfer.

A submitted transaction unresolved for more than 15 minutes becomes an operations exception. That threshold starts investigation; it does not mean the transaction has failed or that Aurel guarantees resolution within 15 minutes.

## A transfer reported after controls close

If your wallet broadcast a previously prepared Base transfer but its hash reaches Aurel after a review expires, access changes, or an account control closes, Activity keeps it in a separate **Transfer review** section. The report is not a new approval. Aurel checks the exact on-chain call, receipt, finality, and expected transfer effect. Until those checks finish it says **Checking transfer**. A settled transfer is marked **Transfer settled — approval review needed**, not an ordinary completed Aurel instruction. A mismatch or reverted transfer is shown separately and sent for operations review. This path cannot reopen signing or change a cancelled instruction into an approved payment.

The same observation-only rule applies to a late Swap report. For a cross-network Swap, checking the first transaction is not the same as confirming delivery; support reviews the result separately. A late report never renews an expired approval or permits another signature.

## Replaced and repeated transactions

A wallet may replace a pending transaction with another transaction using the same nonce. Network explorers may show the original as dropped or replaced. Aurel should preserve the known history rather than rewriting it as though only one request existed.

Before retrying any uncertain transaction, check the wallet activity and authoritative source. Repeating a transfer can produce two valid payments.

## What Aurel cannot reverse

Public-chain transactions are generally irreversible after settlement. Aurel cannot recall funds sent to the wrong address, undo a protocol liquidation, or cancel a confirmed route. Product controls are designed to reduce preventable mistakes before signing.
