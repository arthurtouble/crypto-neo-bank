---
title: Transaction verification
description: What Aura checks before you confirm, and after your transaction is sent.
---

We build each money movement on our server, and you confirm exactly that with your passkey. After you submit it, we check what the network actually recorded. None of this gives us control of your wallet, and it doesn't make a transaction reversible.

## Before you confirm

We check that the feature is switched on and apply any controls you've set.

If you have a daily limit, we value the amount in US dollars:

- USDC counts as $1.
- ETH and WETH use a recent ETH price from Kraken.
- cbBTC uses a recent BTC price from Kraken.
- Other assets use the value in the route's quote.

If we can't find a value, we stop the action. We don't use an estimate from your browser instead.

You confirm any token approval together with the action it allows, as one step. Swap quotes stay on our server, so your browser can't change the transaction.

## After you submit

A transaction hash means something was sent to the network. It doesn't prove the result you expected. We check that:

- the transaction came from your wallet and contains exactly what we prepared;
- it's in a block on the network; and
- the expected transfer, deposit, or withdrawal happened.

Then we mark it completed, as mainstream wallets do. We keep checking until the network makes it final, about 20 minutes later on Base, and the receipt shows when it is. If the result changed before then, we would mark it failed.

For a move between networks, we also wait for LI.FI to report delivery. We check that at least the minimum amount reached your wallet on the other network.

If we don't get a transaction hash in time, the action shows as **Not confirmed**, not failed. Check your wallet's activity.

## What these checks don't cover

You can still use your key outside Aura. Our checks don't freeze your wallet or apply to transactions made elsewhere. Always read the review before you confirm, and check a new recipient in a separate way.
