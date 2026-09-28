---
title: Transaction verification
description: What Aura checks before you confirm, and after your transaction is sent.
---

Aura builds each money movement on its server, and you confirm exactly that with your passkey. After you submit it, Aura checks what the network actually recorded. None of this gives Aura control of your wallet, and it doesn't make a transaction reversible.

## Before you confirm

Aura checks that the feature is switched on and applies any controls you've set.

If you have a daily limit, Aura values the amount in US dollars. USDC counts as $1. ETH and WETH use a recent ETH price from Kraken. cbBTC uses a recent BTC price from Kraken. Other assets use the value in the route's quote. If Aura can't find a value, it stops the action rather than use an estimate from your browser.

Any token approval and the action it enables are confirmed together, as one step. Swap quotes stay on Aura's server, so your browser can't change the transaction.

## After you submit

A transaction hash means something was sent to the network. It doesn't prove the result you expected. Aura checks that:

- the transaction came from your wallet and contains exactly what Aura prepared;
- it's in a block on the network;
- the expected transfer, deposit, or withdrawal happened.

Then Aura marks it completed, as mainstream wallets do. Aura keeps checking until the network makes it final, about 20 minutes later on Base, and the receipt shows when it is. If the result changed before then, Aura would mark it failed.

For a move between networks, Aura also waits for LI.FI to report delivery, and checks that at least the minimum amount reached your wallet on the other network.

If Aura doesn't get a transaction hash in time, the action shows as **Not confirmed**, not failed. Check your wallet's activity.

## What these checks don't cover

You can still use your key outside Aura. Aura's checks don't freeze your wallet or apply to transactions made elsewhere. Always read the review before you confirm, and check a new recipient in a separate way.
