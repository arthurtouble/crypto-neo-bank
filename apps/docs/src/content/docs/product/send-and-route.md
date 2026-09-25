---
title: Send and route
description: Direct transfers, cross-chain routes, checks, and confirmation.
sidebar:
  order: 2
---

## Direct transfers

You can send assets on Base from your Aura account. Before your wallet opens, Aura checks your account lock, daily limit, and recipient settings, then builds the exact transaction. Passing these checks does not certify the recipient or guarantee settlement.

Saving an address does not prove that you control it. Check the full address independently.

### Before sending

- Confirm the chain with the recipient.
- Compare the full address through an independent channel.
- Review the token contract, not only its symbol.
- Use a small test when the destination is new.
- Read the wallet prompt before signing.

A transaction sent to a valid but unintended address is usually irreversible.

## Moving between networks

Use Swap to move an asset to another network. A quote is not a transfer. Any approval and the route are signed together. Leaving the first network and arriving on the second are separate steps.

See [Cross-chain routes](/product/cross-chain-routing/) for delayed-route guidance.

## What confirmation means

- **Submitted** means your wallet signed and a transaction hash exists.
- **Complete** means Aura matched the onchain operation to what you reviewed, waited for the network to finalize it, and found the expected transfer.
- For a cross-chain route, Aura also waits for delivery on the other network.

Quotes, gas, price impact, and timing can change before you sign.

## Your limits

In Settings you can set a daily limit, allow sends only to saved recipients, and set a wait before a new saved recipient can receive (4 hours by default). The daily limit is off by default. Changes apply right away.

These controls only cover sends prepared through Aura. They do not bind a key you export and use elsewhere.

## If a transfer looks stuck

Check the transaction hash on the correct network's explorer. A pending, replaced, reverted, and confirmed transaction need different responses. Do not send the same payment again until you know whether the first instruction settled.

For a route, source confirmation is only one step. Check the destination network's explorer as well. Support can investigate evidence but cannot reverse a confirmed chain transaction.
