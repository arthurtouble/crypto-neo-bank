---
title: Wallets and assets
description: Your Aura account, where your balances come from, and how to keep access.
sidebar:
  order: 1
---

## Your account is your wallet

Privy makes a wallet for you when you first sign in. That wallet is your Aura account, with the same address on every network, controlled through your Privy sign-in. Aura never holds your funds or a key that can move them.

Privy, an independent company, handles sign-in, the key that signs for your wallet, recovery, and export. Aura only receives your public wallet address and your verified sign-in.

You review each transaction Aura prepares, then confirm with your passkey or cancel. Features that aren't live never ask you to confirm. Money only leaves your account after you add a passkey or an authenticator app. Aura pays the network fee, so you don't need ETH for fees.

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

Each item shows a US dollar value, and Overview adds them into a total. Stock, gold, and euro prices pause outside market hours, so those rows say when their price was published. Filter Overview by group, or select an item to see details and to send, swap, or deposit more.

Balances can update at slightly different times in Aura, in your wallet, and on a block explorer. To confirm a payment, check the transaction on the right network's block explorer.

## Totals are estimates

Your total is holdings times current prices, not an offer to buy your assets. Thin markets, old prices, token restrictions, or a stablecoin losing its peg can all mean you'd get a different amount.

Aura leaves out assets it doesn't recognize rather than guessing their value. A missing price doesn't mean the token is worth nothing.

## Earn positions

Aura reads the USDC and WETH you've supplied directly from Aave on Base, and your Morpho vault shares from Base, shown as their USDC value. Between reads, a position grows live at its current yearly rate, as an estimate; the next read replaces it. If a read fails, Aura shows the position as unavailable rather than an old value.

Aura leaves what you've earned, cost basis, and tax value blank until it has complete history to back them up. See [Earn](/product/earn/).

## Keeping access

You get back in by signing in with any method linked to your account: your email, or the wallet you signed up with. Privy handles key export. Aura support will never ask for a seed phrase, private key, recovery secret, or one-time code.

Before you keep a large amount in your account:

1. add a second way to sign in, such as an email, in Settings → Security;
2. secure the email or wallet you sign in with, and the device that holds your passkey;
3. understand what exporting your key means;
4. sign in with each method once, while your balance is small;
5. keep your public address separate from anything you use to recover access.

Exporting your key makes your wallet more portable and puts more responsibility on you. If you use the key elsewhere, Aura's account lock, daily limit, and recipient settings don't apply.

## Adding money

Aura can't recover assets sent on the wrong network or in the wrong token. Send a small first deposit and check it on BaseScan before sending more. See [networks and assets](/product/networks-and-assets/).

:::note[Public activity]
Hiding balances in Aura only hides them on your screen. Your balance and transactions are still public on the blockchain.
:::

## Not a bank deposit

Assets in your wallet and Earn positions aren't bank deposits. Unless a specific regulated product says otherwise in its own terms, don't expect deposit insurance, chargebacks, or bank-style reversals.
