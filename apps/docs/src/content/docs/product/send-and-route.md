---
title: Send money
description: Send assets to an address, a saved recipient, an Aura tag, or your own wallet, on Base or another network, and what each status means.
sidebar:
  order: 2
---

You can send ETH, USDC, EURC, WETH, cbBTC, the Coinbase tokenized stocks, and Tether Gold to any address, a saved recipient, a public Aura tag, or one of your own linked wallets.

Your money is held on Base. You can choose the network it arrives on:

- ETH can go to Ethereum, Arbitrum, or Optimism.
- USDC can go to those and Polygon.
- Other assets are sent on the network where your account holds them: Base, or Ethereum for Tether Gold.

Send has two tabs: **To a person or wallet** for crypto, and **To a bank account** for dollars to a US bank. Enter the amount, then who it's for, then review the asset, amount, recipient, network, and fee. On Base, the fee shows as **Paid by Aura**. You confirm with your passkey.

Aura checks that sending is switched on and applies your controls. It won't send to your own Aura address or to a token's contract address. These checks don't vouch for the recipient or guarantee the payment settles.

## Before you send

- Confirm with the recipient which network they can receive on.
- Check the full address with them another way, such as a call or another app.
- Check the token contract, not just its symbol.
- Send a small test amount to someone new.

A payment sent to the wrong but valid address usually can't be reversed.

## Saved recipients

Saved recipients show above the address field in Send. When you enter an address, Aura tells you whether it's a saved recipient, one of your own wallets, or a new address.

The first time you send to an address, Aura shows it in full before the review, in groups of four, with the network, so you can check it against the address you were given. Select **It's correct** to go on, or **Edit** to change it. This check is skipped for saved recipients, addresses you've sent to before, your own wallets, and addresses from an Aura tag.

You can name and save a new address as you send, and remove saved recipients in Settings. A saved name is just a label; it doesn't prove who controls the address.

## Sending to another network

Choose the network in Send. Aura finds a route through LI.FI, an independent service that uses third-party bridges. Route fees come out of the amount, so the recipient gets a little less than you send. The review shows about how much they'll receive, the least they'll receive, and the fees. Aura still pays the network fee on Base.

If the quote runs out before you confirm, Aura gets a new one and shows it to you first.

Delivery usually takes up to 30 minutes, because many bridges wait for Base to finalize the block. Once the payment leaves Base, Send shows it as sent and you can close it. Follow the rest in Transactions.

The payment is complete only when LI.FI reports delivery and Aura finds the transfer to the recipient on that network. If the bridge refunds it, the money comes back to your account on Base. See [cross-chain routes](/product/cross-chain-routing/).

## Sending to a bank

Bank payouts are coming soon.

## What the status means

- **Submitted** means you confirmed and a transaction hash exists.
- **Complete** means the transaction is in a block, Aura matched it to what you reviewed, and Aura found the expected transfer. Base makes it final about 20 minutes later. The receipt in Transactions shows when.

Timing can change before you confirm.

## Your controls

In **Settings → Security** you can:

- set a daily limit. It counts every send, including sends to your own linked wallets and to other networks;
- send only to saved recipients. When this is on, a newly saved recipient can't receive for 4 hours;
- lock your account.

All of these are off until you turn them on. Changes apply right away. They only cover sends Aura prepares, not a key you export and use elsewhere.

## If a payment looks stuck

For a send to another network, check its status in Transactions first. Otherwise, look up the transaction hash on a Base block explorer. A transaction can be pending, replaced, reverted, or confirmed, and each needs a different response.

Don't send the same payment again until you know what happened to the first one. Support can look into it with you, but can't reverse a confirmed transaction.
