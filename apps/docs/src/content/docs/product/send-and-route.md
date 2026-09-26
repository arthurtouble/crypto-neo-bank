---
title: Send money
description: Send assets on Base to an address, a saved recipient, an Aura tag, or your own wallet, and what each status means.
sidebar:
  order: 2
---

You can send ETH, USDC, WETH, or cbBTC on Base from your Aura account. Send to any Base address, a saved recipient, a public Aura tag, or one of your own linked wallets.

Aura checks that sending is switched on and applies any controls you've set. It won't send to your own Aura address or to a token's contract address. Then it builds the exact transaction.

Before you confirm, you review the asset, amount, recipient, network, and fee. The fee shows as **Paid by Aura**. You confirm with your passkey. These checks don't vouch for the recipient, and they don't guarantee the payment settles.

## Before you send

- Confirm with the recipient that they can receive on Base.
- Check the full address with them in a separate way, such as a call or another app.
- Check the token contract, not just its symbol.
- Send a small test amount to someone new.
- Read the review before you confirm.

A payment sent to the wrong but valid address usually can't be reversed.

Saving an address doesn't prove who controls it. A saved name is just a label for you.

## Sending to another network

Send doesn't go to other networks yet. To move an asset to another network, use Swap. See [cross-chain routes](/product/cross-chain-routing/).

## Sending to a bank

Bank payouts are coming soon.

## What the status means

- **Submitted** means you confirmed and a transaction hash exists.
- **Complete** means Aura matched the transaction to what you reviewed, waited for the network to finalize it, and found the expected transfer.

Timing can change before you confirm.

## Your controls

In Settings you can:

- set a daily limit. It counts every send, including sends to your own linked wallets;
- send only to saved recipients. When this is on, a newly saved recipient can't receive for 4 hours;
- lock your account.

All of these are off until you turn them on, and changes apply right away.

They only cover sends Aura prepares. They don't apply if you export your key and use it somewhere else.

## If a payment looks stuck

Look up the transaction hash on a Base block explorer. A transaction can be pending, replaced, reverted, or confirmed, and each needs a different response.

Don't send the same payment again until you know what happened to the first one.

Support can look into it with you, but can't reverse a confirmed transaction.
