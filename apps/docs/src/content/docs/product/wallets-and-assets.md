---
title: Wallets and assets
description: Your Aura account, where your balances come from, and how to keep access.
sidebar:
  order: 1
---

## Your account is your wallet

Your Aura account is a smart wallet on the Base network. You control it through your Privy sign-in, and its address is your deposit address. Aura never holds your funds or a key that can move them.

Privy, an independent company, handles sign-in, the key that signs for your wallet, recovery, and export. Aura only receives your public wallet address and your verified sign-in.

When you make a transaction, Aura prepares it and checks it first. Your wallet then shows it to you, and you sign or cancel. Features that aren't live never ask you to sign.

A smart wallet can sign a token approval and the action it enables together, as one operation. Aura plans to cover network fees on Base for the actions it prepares, so you won't need ETH for them. That isn't set up yet. Until it is, you need a little ETH on Base.

## Where your balances come from

The blockchain is the final record of what you hold. Aura may keep a copy or format it for the screen, but its own records never override the blockchain.

Your main balance view shows:

| Asset | Network |
| --- | --- |
| ETH | Base |
| USDC | Base |
| WETH | Base |

Balances can update at slightly different times in Aura, in your wallet, and on a block explorer. To confirm a payment, check the transaction on the right network's block explorer.

## Totals are estimates

Your total combines how much you hold with current prices. It's an estimate, not an offer to buy your assets. Thin markets, old prices, token restrictions, or a stablecoin losing its peg can all mean you'd get a different amount.

Aura leaves out assets it doesn't recognize rather than guessing their value. A missing price doesn't mean the token is worth nothing.

## Earn positions

Aura reads your Aave position directly from Aave on Base. When the data is available, it shows how many markets you're in, your net position, and Aave's health factor. It reads your Sky savings from Ethereum.

If Aave reports rewards you can claim, Aura shows them. You can't claim them in Aura yet. A reward on screen isn't a payment.

A position doesn't tell you what you've earned, your cost basis, or a tax value. Aura leaves those blank until it has complete history to back them up.

## Keeping access

Privy handles recovery and export. Aura support will never ask for a seed phrase, private key, recovery secret, or one-time code.

Before you keep a large amount in your account:

1. check the recovery methods Privy offers you;
2. secure the email, phone, device, or social account you sign in with;
3. understand what exporting your key means;
4. test recovery with a small balance;
5. keep your public address separate from anything you use to recover access.

Exporting your key makes your wallet more portable, and puts more responsibility on you. If you use the key elsewhere, Aura's account lock, daily limit, and recipient settings don't apply.

## Adding money

Your address can receive many tokens that Aura doesn't support. Check the network and the token contract before sending. Aura can't recover assets sent on the wrong network or in the wrong token.

For your first deposit, send a small amount and check it on BaseScan before sending more.

:::note[Public activity]
Hiding balances in Aura only hides them on your screen. Your balance and transactions are still public on the blockchain.
:::

## Not a bank deposit

Assets in your wallet and Earn positions aren't bank deposits, even though Aura looks like a banking app. Unless a specific regulated product says otherwise in its own terms, don't expect deposit insurance, chargebacks, or bank-style reversals.
