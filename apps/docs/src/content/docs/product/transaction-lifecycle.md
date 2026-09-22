---
title: Activity and transaction states
description: What prepared, cooling, reviewed, submitted, confirmed, failed, and cancelled mean.
---

Activity is an evidence trail, not just a list of successful payments. Aurel records the states it observes so customers and operations can distinguish a request from a settled result.

## Standard lifecycle

1. **Request.** The customer enters the action, amount, network, destination, or protocol position.
2. **Prepare.** Aurel or the integrated protocol produces an unsigned transaction plan.
3. **Validate.** The server checks product policy, supported contracts, account controls, and required disclosures.
4. **Simulate.** Supported direct sends use gas estimation and an execution call. Protocol screens preview the expected position change.
5. **Confirm.** The wallet presents the final transaction. The customer signs or cancels.
6. **Submit.** A transaction hash exists and the source network has received the transaction.
7. **Observe.** Aurel checks the source receipt and, where relevant, the provider or destination state.

The action screen now uses the same four visible checkpoints everywhere: **Review**, **Confirm**, **Submitted**, and **Complete**. Send, Add Money, Withdraw, Earn, Borrow, and Repay all use this language. The progress panel can be closed after submission; the request remains visible in Activity.

## State meanings

| State | Meaning |
| --- | --- |
| **Blocked** | A policy rule rejected the request. No signing request was created. |
| **Cooling** | A new-destination or high-value waiting period is active. |
| **Reviewed** | The hold elapsed and the same instruction was revalidated. This release expires after 15 minutes. |
| **Submitted** | The customer signed and a transaction hash exists. Settlement is still pending. |
| **Confirmed** | The supported source-chain receipt reports successful execution. |
| **Failed** | Preparation, submission, provider handling, or the source receipt failed. |
| **Cancelled** | The instruction was cancelled before settlement. |

“Submitted” and “Complete” are deliberately different. A transaction hash proves that a request was submitted, not that it settled. While the action screen is open, Aurel asks its authenticated status endpoint to reconcile the source-chain receipt and upgrades the visible state only after receipt evidence exists.

States do not move arbitrarily. For example, a cooling instruction must be reviewed before submission, and a submitted instruction needs receipt evidence before Aurel calls it confirmed.

Open an item in Activity to see its recorded timeline. It can include security review, completion of a security delay, network submission, and final confirmation or failure. Timeline entries come from append-only intent events; the blockchain or provider still controls settlement truth.

## Instruction fingerprints

A high-value action that completes its cooling period is not released as a blank approval. Aurel compares the network, asset, amount, destination, and relevant call data with the original instruction. If a material field changes, the previous review does not apply.

The reviewed state lasts 15 minutes. After that, the customer must prepare the action again. This prevents an old approval window from remaining open indefinitely.

## Simulations are estimates

Simulation can catch a likely revert and estimate gas under current state. It cannot guarantee execution at a later block. Prices, balances, allowances, contract state, network conditions, and oracle values can change before settlement.

For a protocol action, previewed health factors and rates are decision support. They are not guaranteed outcomes.

## Receipt checks

Aurel checks supported submitted transactions using source-chain JSON-RPC. The activity record can include the transaction hash, source block, receipt result, last-check time, and available route or provider reference.

For a cross-network transfer, source-chain confirmation does not prove that funds have arrived on the destination network. The action screen therefore says that arrival still depends on the route, and Activity preserves the route reference when one is available.

A submitted transaction unresolved for more than 15 minutes becomes an operations exception. That threshold starts investigation; it does not mean the transaction has failed or that Aurel guarantees resolution within 15 minutes.

## Replaced and repeated transactions

A wallet may replace a pending transaction with another transaction using the same nonce. Network explorers may show the original as dropped or replaced. Aurel should preserve the known history rather than rewriting it as though only one request existed.

Before retrying any uncertain transaction, check the wallet activity and authoritative source. Repeating a transfer can produce two valid payments.

## What Aurel cannot reverse

Public-chain transactions are generally irreversible after settlement. Aurel cannot recall funds sent to the wrong address, undo a protocol liquidation, or cancel a confirmed route. Product controls are designed to reduce preventable mistakes before signing.
