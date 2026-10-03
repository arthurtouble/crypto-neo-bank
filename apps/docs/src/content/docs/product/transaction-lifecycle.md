---
title: Transactions and their status
description: What Transactions lists, what pending, completed, failed, and not sent mean, and how exports and statements work.
---

Transactions lists the money you send, swap, move, and put in Earn with Aura, your card payments, and the money you receive. Getting a quote doesn't add anything. If you start something and don't confirm it in time, it shows as **Not sent**.

The list is grouped by day, newest first. You can search, pick a type (**All**, **Sent**, **Received**, **Card**, **Swaps**, **Earn**, **Markets**, or **Other**), or filter by status. If part of your history can't be read, one note above the list names what's missing, and the rest still shows. **Show more**, under the list, loads older activity.

For the steps from asking to settling, see [how Aura works](/concepts/architecture/). You can cancel any time before you confirm.

## What each status means

| Status | Meaning |
| --- | --- |
| **Pending** | You confirmed it, and Aura is waiting for it to be included on the network. A move between networks stays pending until it arrives. |
| **Completed** | It's in a block and matches what you reviewed: the expected transfer or deposit appeared. A move between networks must also arrive. Your balance already includes it. |
| **Failed** | The network rejected it, the route failed, or the result didn't match what you reviewed. The receipt shows the reason. |
| **Not sent** | You didn't confirm it in time, so nothing was sent. Check your activity before you try again. This isn't the same as failed. |

A transaction on Base is usually completed within seconds and **final** about 20 minutes later, once it's settled on Ethereum. Until then, a block could very rarely be rewritten, so Aura keeps checking. The receipt and exports show when it's final. What Aura checks: [after you submit](/safety/security-model/#after-you-submit).

## Receipts

Open any item to see its receipt: beside the list on a computer, on its own screen on a phone. For something you did in Aura, the receipt shows each step with its time, and updates while you watch:

- A send on Base goes from sent, to complete on Base, to final on Base.
- A send to another network goes from sent from Base, to confirmed on Base, to delivered on the other network, to complete.

A bank payout also lists Bridge's updates, up to delivery to your bank. If something failed, the receipt says why in plain words. Setting your card's spending allowance moves no money, so it shows without an amount.

## Money you receive

Money sent to your Aura address shows as **Received**: a deposit from an exchange, a payment from someone else, or a transfer from your own wallet. Aura lists the assets it supports on the networks where your account holds them: Base, and Ethereum for Tether Gold. Unsupported tokens are left out, so unsolicited tokens don't clutter your list.

A deposit is **Completed** as soon as it's in a block. The receipt shows who sent it, a link to the network, and whether it's final yet.

- Aura reads received money from Alchemy's record of the network and doesn't store it. If that record can't be read, Transactions says some deposits may be missing, rather than showing none.
- **Show more** loads older deposits. A monthly statement covers a whole month.
- ETH sent to you by a smart contract, rather than a wallet, may not be listed.
- The value shown is today's value, not its value when it arrived.

## Card payments

Card payments come from Stripe, which issues the card.

- A purchase is **Pending** while the merchant holds the amount, and **Completed** once the merchant settles it.
- A declined purchase shows as **Failed**. No money moved.
- Refunds show as money in.

The receipt links to the Base transaction in which Bridge took your USDC, and shows any dispute. If Stripe can't be read, Transactions says some card payments may be missing, rather than showing none.

## Aave history

Transactions can also show your Aave history, from Aave. Each record shows where it came from. Outside history doesn't mean Aura started or checked that transaction.

## Exports and statements

**Export**, at the top of Transactions, downloads a CSV file:

- **This list** has the transactions you see, with your filters applied: date, description, status, amounts, assets, who it was with, estimated US dollar value, network, transaction, and source.
- **Monthly statement** has everything in a calendar month, oldest first: what you did in Aura, card payments, and money you received. If Aura can't read all the received money or card payments for that month, it won't give you an incomplete statement. Try again later.

Aura doesn't guess a purchase price, gain or loss, or tax treatment. These files support your records. They aren't bank statements, tax returns, or tax advice.

## Insights

Insights adds up your completed transactions for a period:

- money in: received, and card refunds;
- money out: sent, and card payments;
- added to Earn;
- swapped: swaps and moves between networks.

Anything without a US dollar value is counted separately, never as zero. If received money can't all be read, money in shows as **Unavailable**. If card payments can't all be read, both money in and money out show as **Unavailable**.

Pick a period: **7D**, **30D**, **90D**, or **1Y**. If nothing completed in the period, Insights says so and offers **Deposit**. **Money in and out** charts both, by day over 7 days, by week (starting Monday) over 30 or 90 days, and by month over a year. Days start at midnight UTC. Point at a bar to see its amounts, or choose **Show as a table**. If only one of money in or money out can be read, the chart shows that one and tells you. If neither can, it says so.

**Top card merchants** lists the five merchants you paid most by card in the period, with the number of payments to each. It counts settled payments only, not declines or refunds. If card payments can't all be read, it says so.

## Moves between networks

Aura marks a move completed only after LI.FI reports delivery and Aura sees at least the minimum amount arrive. The receipt tells you if less arrives, a refund is reported, or delivery fails. See [moves between networks](/product/cross-chain-routing/).

Our operations team is alerted if a transaction is still waiting for the network after 15 minutes, or still pending after 2 hours. That starts an investigation. It doesn't mean the transaction failed.

## Retries and reversals

Check Transactions and a block explorer before retrying anything uncertain. Repeating a transfer can mean paying twice.

Blockchain transactions generally can't be reversed once settled. Aura can't recall funds sent to the wrong address, or cancel a confirmed move between networks.
