---
title: Send money
description: Send assets to an address, a saved recipient, an Aura tag, or your own wallet, on Base or another network, and what each status means.
---

You can send any [supported asset](/product/networks-and-assets/#supported-assets) to any address, a saved recipient, a public Aura tag, or one of your own linked wallets.

Your money is held on Base. You can choose the network it arrives on:

- ETH can go to Ethereum, Arbitrum, or Optimism.
- USDC can go to those and Polygon.
- Other assets are sent on the network where your account holds them: Base, or Ethereum for Tether Gold.

Send has two tabs: **To a person or wallet** for crypto, and **To a bank account** for dollars to a US bank. Start with who it's for: tap someone you've paid before, paste an address, or type an Aura tag like `@sam`, and Aura finds its address when you select **Review**. Then enter the amount. Review what you send, who to, the network, and any fee. The network fee shows as **Paid by Aura**. Select **Send** and confirm with your passkey.

Send tells you before you start if something would stop the payment: sending is paused, your account is locked, an asset is paused, or your settings only allow saved recipients. If you have a daily limit, Send shows how much more you can send today. If sending to other networks is paused, only the network your account holds the asset on is offered. If Aura still can't send it, the reason shows above the button and nothing is sent.

Aura checks that sending is switched on and applies your controls. It won't send to your own Aura address or to a token's contract address. These checks don't vouch for the recipient or guarantee the payment settles.

## Before you send

- Confirm with the recipient which network they can receive on.
- Check the full address with them another way, such as a call or another app.
- Check the token contract, not just its symbol.
- Send a small test amount to someone new.

A payment sent to the wrong but valid address usually can't be reversed.

## Saved recipients

The people you've paid show at the top of Send, the most recent first, with your saved recipients and your own wallets. An address you haven't saved shows the date you last paid it, with the start and end of the address. When you tap someone you've paid before, Send also picks the asset and network you used last time, and says so. You can change them. When you enter an address, Aura tells you whether it's a saved recipient, one of your own wallets, or a new address.

If your settings only allow saved recipients, Send offers only those, and a new address must be saved in Settings first. A newly saved recipient can receive once its waiting period ends, and Send shows when that is.

The first time you send to an address, Aura shows it in full before the review, in groups of four, with the network, so you can check it against the address you were given. Select **It's correct** to go on, or **Edit** to change it. This check is skipped for saved recipients, addresses you've sent to before, your own wallets, and addresses from an Aura tag.

You can name and save a new address as you send, and remove saved recipients in Settings. A saved name is just a label; it doesn't prove who controls the address.

## Sending to another network

Choose the network in Send. Aura finds a route through LI.FI, an independent service that uses third-party bridges. Route fees come out of the amount, so the recipient gets a little less than you send. The review shows about how much they'll receive, the least they'll receive, and the fees. Aura still pays the network fee on Base.

If the quote runs out before you confirm, Aura gets a new one and shows it to you first.

Delivery usually takes up to 30 minutes, because many bridges wait for Base to finalize the block. Once the payment leaves Base, Send shows it as sent and you can close it. Follow the rest in Transactions.

The payment is complete only when LI.FI reports delivery and Aura finds the transfer to the recipient on that network. If the bridge refunds it, the money comes back to your account on Base. See [moves between networks](/product/cross-chain-routing/).

## Sending to a bank

Bank payouts are coming soon.

## After you confirm

Send shows the steps as you go: **Submitted** once a transaction hash exists, then **Complete** once it's in a block and matches what you reviewed. A send to another network shows as **sent** once it leaves Base. In Transactions, it's **Pending**, **Completed**, **Failed**, or **Not sent**; see [transactions and their status](/product/transaction-lifecycle/#what-each-status-means).

Your [account controls](/safety/account-controls/) apply to every send: a daily limit, saved recipients only, and the emergency lock. They're off until you turn them on.

## If a payment looks stuck

For a send to another network, check its status in Transactions first. Otherwise, look up the transaction hash on a Base block explorer. A transaction can be pending, replaced, reverted, or confirmed, and each needs a different response.

Don't send the same payment again until you know what happened to the first one. Support can look into it with you, but can't reverse a confirmed transaction.
