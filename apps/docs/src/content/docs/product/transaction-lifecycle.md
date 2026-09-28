---
title: Transactions and their status
description: What Transactions lists, what pending, completed, failed, and not confirmed mean, and how exports and statements work.
---

Transactions lists the money you send, swap, move, and put in Earn with Aura, and the money you receive. Getting a quote doesn't add anything to the list. If you start something and don't confirm it in time, it shows as **Not confirmed**.

## How a money movement works

1. **You ask.** You choose the action, amount, network, and recipient or position.
2. **Aura prepares it.** Aura's server checks that the feature is on, applies any controls you've set, and builds the exact transaction.
3. **You confirm.** You review it in Aura and confirm with your passkey. You can cancel.
4. **Privy submits it.** Aura sends your signed request to Privy, which submits it to the network and pays the fee.
5. **Aura checks it.** Aura reads the blockchain itself and checks the result.

## What each status means

| Status | Meaning |
| --- | --- |
| **Pending** | You confirmed it, and Aura is waiting for it to be included on the network. A move between networks stays pending until it arrives. |
| **Completed** | It's in a block on the network, and it matches what you reviewed: the expected transfer or deposit appeared. A move between networks must also arrive. Your balance already includes it. |
| **Failed** | The network rejected it, the route failed, or the result didn't match what you reviewed. The receipt shows the reason. |
| **Not confirmed** | You didn't confirm it in time, so nothing was sent. Check your activity before you try again. This isn't the same as failed. |

A transaction hash only proves something was submitted. Before Aura marks a transaction completed, it compares what was signed, and what it did, with what Aura prepared.

Like mainstream wallets and apps, Aura shows a transaction on Base as completed once it's in a block, which usually takes a few seconds. Base then makes it **final** about 20 minutes later, once it's settled on Ethereum. Until then a block could, very rarely, be rewritten, so Aura keeps checking and the receipt shows when it's final. Exports show it too.

Open any item to see its receipt. For something you did in Aura, the receipt shows its journey, step by step, with the time of each step. A send on Base goes from sent, to complete on Base, to final on Base. A send to another network goes from sent from Base, to confirmed on Base, to delivered on the other network, to complete. The journey updates by itself while you watch. **Full history** opens the same transaction on its own page.

## Money you receive

Money sent to your Aura address shows as **Received**: a deposit from an exchange, a payment from someone else, or a transfer from your own wallet. Aura lists the assets it supports on the networks where your account holds them: Base, and Ethereum for Tether Gold. Tokens Aura doesn't support are left out, so unsolicited tokens don't clutter your list.

A deposit is **Completed** as soon as it's in a block, like the transactions you make. The receipt shows who sent it, a link to the network, and whether it's final yet.

Aura reads received money from Alchemy's record of the network, and doesn't store it. If that record can't be read, Transactions tells you some deposits may be missing, rather than showing none. The list shows your most recent deposits; a monthly statement covers a whole month. ETH sent to you by a smart contract, rather than a wallet, may not be listed.

The value shown for money you received is today's value, not its value when it arrived.

## Aave history

Transactions can also show your Aave history, from Aave. Each record shows where it came from. Outside history doesn't mean Aura started or checked that transaction.

## Exports and statements

**Export** downloads a CSV file:

- **This list** has the transactions you see, with your filters: date, description, status, amounts, assets, who it was with, estimated US dollar value, network, transaction, and source.
- **Tax-support preview** is the same list, with blanks marked for tax classification and cost basis.
- **Monthly statement** has everything in a calendar month, oldest first: what you did in Aura and money you received. If received money for that month can't all be read, Aura doesn't give you a statement that's missing it. Try again later.

Aura doesn't guess a purchase price, gain or loss, or tax treatment. Missing cost basis shows as **Unavailable**, and tax classification shows as **Review required**. These files support your records. They aren't bank statements, tax returns, or tax advice.

## Insights

Insights adds up your completed transactions for a period: money in (received), money out (sent), put to work (added to Earn), and moved (swaps and moves between networks). Anything without a US dollar value is counted separately, never as zero. If received money can't all be read, money in shows as **Unavailable**.

## Moves between networks

When you move an asset between networks, the first network confirming doesn't prove delivery. The journey shows confirmation on Base and delivery on the other network as separate steps.

Aura marks the move completed only after LI.FI reports delivery and Aura sees at least the minimum amount arrive. If less arrives, a refund is reported, or delivery fails, the receipt tells you.

If a transaction is still waiting for the network after 15 minutes, or still pending after 2 hours, our operations team is alerted. That starts an investigation. It doesn't mean the transaction failed.

## Before you retry

Before retrying anything uncertain, check Transactions and a block explorer. Repeating a transfer can mean paying twice.

## What Aura can't reverse

Blockchain transactions generally can't be reversed once settled. Aura can't recall funds sent to the wrong address, or cancel a confirmed move between networks. Aura's controls are there to help you catch mistakes before you confirm.
