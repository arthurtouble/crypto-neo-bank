---
title: Cross-chain routes
description: How moves between networks are quoted, signed, and tracked.
---

You can use Swap to move an asset from one network to another. This is how you withdraw to a network other than Base. To add money from another network, use **Deposit > From your wallet**. Aura moves it to the same asset on Base, using a route LI.FI finds. Bridge fees come out of the amount, and your wallet pays the fee on the network you send from.

## Getting a quote

LI.FI finds the route. It chooses among third-party bridges and exchanges, and estimates what you'll receive, the fees, and the timing. A quote lasts 45 seconds. It isn't a transfer.

Before you confirm, Aura checks the assets, networks, amount, recipient, and price impact, and applies any controls you've set. Any token approval and the move itself are confirmed together, as one step.

## While it's moving

When the first network confirms, the move has started. That doesn't mean it has arrived. Aura shows it as **On its way** until LI.FI reports delivery and Aura sees at least the minimum amount arrive in your wallet on the other network.

## If it seems stuck

1. Open the transaction in Transactions.
2. Check it on both networks' block explorers.
3. Don't repeat the move yet. Repeating it can send your funds twice.
4. If it's still unresolved, open a support case with the transaction hash.

Never share a private key or recovery phrase, including with Aura support.
