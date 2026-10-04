---
title: Send money
description: Send assets to an address, a saved recipient, an Aura tag, or your own wallet, on Base or another network, and what each status means.
---

You can send any [supported asset](/product/networks-and-assets/#supported-assets) to any address, a saved recipient, a public Aura tag, or one of your own linked wallets.

Your money is held on Base. You can choose the network it arrives on:

- ETH can go to Ethereum, Arbitrum, or Optimism.
- USDC can go to those and Polygon.
- Other assets are sent on the network where your account holds them: Base, or Ethereum for Tether Gold.

Send has two tabs: **To a person or wallet** for crypto, and **To a bank account** for dollars to a US bank. Enter the amount, then who it's for: paste an address, or type an Aura tag like `@sam`, and Aura finds its address when you select **Review**. Then review the asset, amount, recipient, network, and fee. The network fee shows as **Paid by Aura**. You confirm with your passkey.

If Aura can't send it, for example because it's over your daily limit, the reason shows above the button and nothing is sent. If sending is paused, Send says so before you start. If sending to other networks is paused, only the network your account holds the asset on is offered.

Aura checks that sending is switched on and applies your controls. It won't send to your own Aura address or to a token's contract address. These checks don't vouch for the recipient or guarantee the payment goes through.

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

Choose the network in Send. Aura gets a quote from third-party transfer services. A moving fee comes out of the amount, so the recipient gets a little less than you send. The review shows about how much they'll receive, the least they'll receive, and **Fees**, with the moving fee underneath. Aura still pays the network fee on Base.

If the quote runs out before you confirm, Aura gets a new one and shows it to you first.

Delivery usually takes up to 30 minutes, because many transfer services wait until the block on Base is final. Once the payment leaves Base, Send shows it as sent and you can close it. Follow the rest in Transactions.

The payment is complete only when the transfer service reports delivery and Aura finds the transfer to the recipient on that network. If the transfer service refunds it, the money comes back to your account on Base. See [moves between networks](/product/cross-chain-routing/).

## Sending to a bank

Bank payouts are coming soon.

## After you confirm

Send shows the steps as you go: **Submitted** once a transaction hash exists, then **Complete** once it's in a block and matches what you reviewed. A send to another network shows as **sent** once it leaves Base. In Transactions, it's **Pending**, **Completed**, **Failed**, or **Not sent**; see [transactions and their status](/product/transaction-lifecycle/#what-each-status-means).

Your [account controls](/safety/account-controls/) apply to every send: a daily limit, saved recipients only, and the emergency lock. They're off until you turn them on.

## If a payment looks stuck

For a send to another network, check its status in Transactions first. Otherwise, look up the transaction hash on a Base block explorer. A transaction can be pending, replaced, reverted, or confirmed, and each needs a different response.

Don't send the same payment again until you know what happened to the first one. Support can look into it with you, but can't reverse a confirmed transaction.
