---
title: Send money
description: Send assets on Base to an address or an Aura tag, and what each status means.
sidebar:
  order: 2
---

You can send assets on Base from your Aura account to any Base address or to a public Aura tag.

Before your wallet opens, Aura checks that sending is switched on and applies any controls you've set. Then it builds the exact transaction for you to sign. These checks don't vouch for the recipient, and they don't guarantee the payment settles.

## Before you send

- Confirm with the recipient that they can receive on Base.
- Check the full address with them in a separate way, such as a call or another app.
- Check the token contract, not just its symbol.
- Send a small test amount to someone new.
- Read the wallet prompt before you sign.

A payment sent to the wrong but valid address usually can't be reversed.

Saving an address doesn't prove who controls it. A saved name is just a label for you.

## Sending to another network

To send an asset to another network, use Swap. See [cross-chain routes](/product/cross-chain-routing/).

## What the status means

- **Submitted** means you signed and a transaction hash exists.
- **Complete** means Aura matched the transaction to what you reviewed, waited for the network to finalize it, and found the expected transfer.

Fees and timing can change before you sign.

## Your controls

In Settings you can:

- set a daily limit;
- send only to saved recipients;
- set a wait before a newly saved recipient can receive. It's 4 hours unless you change it.

All of these are off until you turn them on, and changes apply right away.

They only cover sends Aura prepares. They don't apply if you export your key and use it somewhere else.

## If a payment looks stuck

Look up the transaction hash on a Base block explorer. A transaction can be pending, replaced, reverted, or confirmed, and each needs a different response.

Don't send the same payment again until you know what happened to the first one.

Support can look into it with you, but can't reverse a confirmed transaction.
