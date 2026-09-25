---
title: Wallets and assets
description: How Aura shows ownership, balances, and wallet authority.
sidebar:
  order: 1
---

## Wallet authority

Your Aura account is a smart wallet on Base. It is controlled by your Privy sign-in, and its address is your deposit address. Aura does not hold a key that can move your assets.

The smart wallet signs an approval and the action it enables together, as one operation. Once fee sponsorship is set up, Aura covers the network fee on Base for actions it prepares, so you won't need ETH for gas there. That setup is not finished yet; until it is, your account uses your Privy wallet directly and you need gas.

For an available action, Aura prepares and checks the transaction before your wallet shows it. You sign or cancel. Preview-only features never request a signature.

Sign-in, signing, recovery, and export follow Privy's model. Aura receives the public wallet address and verified identity it needs to provide the product.

## Where balances come from

The chain is the final record for onchain assets. Aura can cache or format that data for the interface, but an Aura database value does not override the chain.

The main asset view currently reads:

| Asset | Network | Source |
| --- | --- | --- |
| ETH | Base | Native balance |
| USDC | Base | Token contract |
| WETH | Base | Token contract |

Balances can update at different times because the interface, RPC endpoint, indexer, and block explorer do not all observe a transaction simultaneously. For settlement, use the correct chain and transaction receipt as the primary evidence.

## Portfolio totals

Portfolio values combine token quantities with price data. A displayed total is an estimate, not a redemption quote. Thin liquidity, stale prices, token restrictions, or a stablecoin depeg can make the realizable value different.

Unknown or unsupported assets are excluded rather than assigned a guess. A missing price should not be treated as zero value or proof that the token is worthless.

## DeFi positions

Portfolio reads your Aave V3 position directly from Aave and Base. It shows the source-reported active-market count, health factor, and net position when those fields are available.

Aura also reads claimable rewards from Aave's rewards interface when available. Portfolio shows the source-reported reward and USD estimate without treating an unavailable response as a zero balance. Claiming in Aura is currently unavailable; a displayed reward is not a completed payment.

A current position still does not establish yield earned, cost basis, or a tax value. Aura leaves those figures unavailable until complete authoritative history can support them.

## Wallet recovery

Recovery and export follow Privy’s customer controls. Aura support will never ask for a seed phrase, private key, recovery secret, or one-time code.

Before relying on a wallet for significant value:

1. confirm the recovery methods shown by Privy;
2. secure the email, device, passkey, or social account involved;
3. understand how export changes the security boundary;
4. test access from a recovery scenario with a small balance;
5. keep public wallet addresses separate from private recovery material.

Exporting your key gives you more portability and more direct responsibility. If you use it elsewhere, Aura's account lock, daily limit, and recipient settings don't apply.

## Deposits

The wallet address may accept many EVM tokens that Aura does not support. Check the exact network and asset contract before sending. Aura does not automatically recover assets sent through the wrong network or contract.

For a first deposit, start with a small amount and verify it on BaseScan before sending more.

:::note[Public activity]
The balance-privacy setting only hides numbers on your screen. It does not hide transactions or balances on a public blockchain.
:::

## No deposit insurance claim

Onchain wallet assets and DeFi positions are not bank deposits merely because Aura presents them in a bank-like interface. Unless a specific future regulated product says otherwise in its own terms, do not assume deposit insurance, chargeback rights, or bank-style reversibility.
