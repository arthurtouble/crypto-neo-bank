---
title: Activity and transaction states
description: What submitted, on its way, complete, failed, and not confirmed mean.
---

Transactions shows more than successful payments. It records what Aura saw at each step, so you can tell a request apart from a settled result. Getting a quote doesn't add anything to the list.

## How a money movement works

1. **You ask.** You choose the action, amount, network, and recipient or position.
2. **Aura prepares it.** Aura's server checks that the feature is on, applies any controls you've set, and builds the exact transaction.
3. **You confirm.** You review it in Aura and confirm with your passkey. You can cancel.
4. **Privy submits it.** Aura sends your signed request to Privy, which submits it to the network and pays the fee.
5. **Aura checks it.** Aura reads the blockchain itself and checks the result.

## What each status means

| Status | Meaning |
| --- | --- |
| **Blocked** | A feature switch or one of your controls stopped the request. Nothing was sent. |
| **Submitted** | You confirmed and a transaction hash exists. Aura is still checking. |
| **On its way** | A move between networks has left the first network. It hasn't arrived yet. |
| **Complete** | The transaction matches what you reviewed, the network finalized it, and the expected transfer or deposit appeared. A move between networks must also arrive. |
| **Failed** | The network rejected it, the route failed, or the result didn't match what you reviewed. Transactions shows the reason. |
| **Not confirmed** | Aura didn't get a transaction hash in time. Check the transaction before you try again. This isn't the same as failed. |

A transaction hash only proves something was submitted. Before Aura marks a transaction complete, it compares what was signed, and what it did, with what Aura prepared. A receipt alone isn't enough. Aura keeps checking until the network treats the transaction as final, because earlier blocks can occasionally be rewritten.

Open any item to see its journey, step by step, with the time of each step. A send on Base goes from sent, to included on Base, to final and complete. A send to another network goes from sent from Base, to confirmed on Base, to delivered on the other network, to complete. Only the step in progress shows as loading, and the journey updates by itself while you watch. It's only ever added to, never edited. The blockchain or partner still decides whether it settled.

Transactions can also show your Aave history from an outside source. Each record shows where it came from. Outside history doesn't mean Aura started or checked that transaction.

## Exports

Before it creates a file, the export dialog tells you what's in your current view. It shows how many rows have network receipts, how many came straight from the protocol, and how many have a US dollar estimate.

- **Activity CSV** includes dates, amounts, statuses, sources, and transaction hashes.
- **Tax Support CSV** adds where each record came from, with clearly marked blanks for tax classification and cost basis.

Aura doesn't guess a purchase price, gain or loss, or tax treatment when it doesn't have the evidence. Missing cost basis shows as **Unavailable**, and tax classification shows as **Review required**. The file supports your records. It isn't a bank statement, a tax return, or tax advice.

Aave history comes in pages and can be temporarily unavailable. If the data is partial or missing, the export tells you. It won't pretend the file is complete.

## Moves between networks

When you move an asset between networks, the first network confirming doesn't prove delivery. Transactions shows confirmation on Base and delivery on the other network as separate steps.

Aura marks the move complete only after LI.FI reports delivery and Aura sees at least the minimum amount arrive. If less arrives, a refund is reported, or delivery fails, Transactions tells you.

If a move is unresolved for more than 15 minutes, our operations team is alerted. That starts an investigation. It doesn't mean the move failed.

## Replaced and repeated transactions

A wallet can replace a pending transaction with a new one. Block explorers may then show the original as dropped or replaced. Aura keeps the full history rather than rewriting it as one request.

Before retrying anything uncertain, check your wallet's activity and a block explorer. Repeating a transfer can mean paying twice.

## What Aura can't reverse

Blockchain transactions generally can't be reversed once settled. Aura can't recall funds sent to the wrong address, or cancel a confirmed move between networks. Aura's controls are there to help you catch mistakes before you confirm.
