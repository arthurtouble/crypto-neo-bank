---
title: Wallets and assets
description: Your Aura account, where your balances come from, and how to keep access.
sidebar:
  order: 1
---

## Your account is your wallet

Privy makes a wallet for you when you first sign in. That wallet is your Aura account, and it has the same address on every network. You control it through your Privy sign-in. Aura never holds your funds or a key that can move them.

Privy, an independent company, handles sign-in, the key that signs for your wallet, recovery, and export. Aura only receives your public wallet address and your verified sign-in.

When you make a transaction, Aura prepares it and checks it first. You review it in Aura, then confirm with your passkey or cancel. Features that aren't live never ask you to confirm.

Money only leaves your account after you add a passkey or an authenticator app. Aura pays the network fee for actions from your account, so you don't need ETH to pay fees.

## Where your balances come from

The blockchain is the final record of what you hold. Aura may keep a copy or format it for the screen, but its own records never override the blockchain.

Your main balance view shows:

| Asset | Network | Group |
| --- | --- | --- |
| ETH | Base | Crypto |
| USDC | Base | Cash |
| EURC | Base | Cash |
| WETH | Base | Crypto |
| cbBTC | Base | Crypto |
| Ten Coinbase tokenized stocks | Base | Stocks |
| Tether Gold (XAUt) | Ethereum | Metals |
| Aave USDC and WETH you've supplied | Base | Earn |
| Morpho USDC vaults (Steakhouse Prime USDC, Gauntlet USDC Prime) | Base | Earn |

Each item shows a US dollar value, and Overview adds them up into a total. Stock, gold, and euro prices pause outside market hours, so those rows say when their price was published.

Balances can update at slightly different times in Aura, in your wallet, and on a block explorer. To confirm a payment, check the transaction on the right network's block explorer.

## Totals are estimates

Your total combines how much you hold with current prices. It's an estimate, not an offer to buy your assets. Thin markets, old prices, token restrictions, or a stablecoin losing its peg can all mean you'd get a different amount.

Aura leaves out assets it doesn't recognize rather than guessing their value. A missing price doesn't mean the token is worth nothing.

## Earn positions

Aura reads the USDC and WETH you've supplied directly from Aave on Base. It reads your Morpho vault shares from Base and shows what they're worth in USDC. If a read fails, Aura shows the position as unavailable rather than an old value.

A position doesn't tell you what you've earned, your cost basis, or a tax value. Aura leaves those blank until it has complete history to back them up.

## Keeping access

Privy handles recovery and export. Aura support will never ask for a seed phrase, private key, recovery secret, or one-time code.

Before you keep a large amount in your account:

1. check the recovery methods Privy offers you;
2. secure the email or wallet you sign in with, and the device that holds your passkey;
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
