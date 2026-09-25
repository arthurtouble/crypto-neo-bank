---
title: Transaction verification
description: What Aura checks before you sign, and after your transaction is sent.
---

Aura builds each money movement on its server, and your wallet signs exactly that. After you submit it, Aura checks what the network actually recorded. None of this gives Aura control of your wallet, and it doesn't make a transaction reversible.

## Before you sign

Aura checks that the feature is switched on and applies any controls you've set.

If you have a daily limit, Aura values the amount in US dollars. Supported stablecoins count as $1. ETH uses a recent price from Kraken. Other assets use the value in the route's quote. If Aura can't find a value, it stops the action rather than use an estimate from your browser.

Any token approval and the action it enables are signed together, as one operation. Swap quotes stay on Aura's server, so your browser can't change the transaction.

## After you submit

A transaction hash means your wallet sent something. It doesn't prove the result you expected. Aura checks that:

- the transaction came from your wallet and contains exactly what Aura prepared;
- the network has finalized it;
- the expected transfer, deposit, or withdrawal happened.

For a move between networks, Aura also waits for LI.FI to report delivery, and checks that at least the minimum amount reached your wallet on the other network.

If Aura doesn't get a transaction hash in time, the action shows as **Not confirmed**, not failed. Check your wallet's activity.

## What these checks don't cover

You can still use your key outside Aura. Aura's checks don't freeze your wallet or apply to transactions made elsewhere. Always read the wallet prompt, and check a new recipient in a separate way.
