---
title: Transaction verification
description: What Aura checks before and after a money movement.
---

Aura builds each money movement on its server, and your wallet signs exactly that. After you submit it, Aura checks what the network recorded. These checks do not take control of your wallet or make a transaction reversible.

## Before signing

Aura checks that the feature is on, your account is not locked, and the action fits your daily limit and recipient settings. Limits use a recent independent price, or the route's quoted value. If a limit is set and the value is unknown, the action stops rather than using an estimate from your browser.

Any token approval and the action it enables are signed together, as one operation. Swap quotes stay on Aura's server; the browser cannot change the transaction.

## After submission

A transaction hash means your wallet broadcast something. It does not prove the expected result. Aura checks that:

- the onchain operation came from your wallet and contains exactly the calls Aura prepared;
- the network has finalized it;
- the expected transfer, deposit, or withdrawal appears in that operation.

For a cross-network move, Aura also waits for LI.FI to report delivery and checks that at least the minimum amount reached your wallet on the other network.

If Aura doesn't receive a hash in time, the action shows as **Not confirmed**, not failed. Check your wallet activity.

## What these controls do not cover

You can still use your key outside Aura. Aura's controls do not freeze the wallet or apply to transactions made elsewhere. Always read the wallet prompt and check a new recipient through an independent channel.
