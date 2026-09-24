---
title: Wallets and assets
description: How Aura shows ownership, balances, and wallet authority.
sidebar:
  order: 1
---

## Wallet authority

Privy provides Aura’s sign-in and embedded-wallet infrastructure. You can also connect an external EVM wallet. Aura does not hold a private key that can move your assets on its own.

For an available action, Aura prepares and checks the transaction before your wallet shows the final request. You can sign or cancel it. Preview-only features never request a signature.

An embedded wallet is not an Aura company wallet. Wallet creation, signing, recovery, and export follow the configured Privy model. Aura receives the public wallet reference and verified customer identity needed to provide the product.

An external wallet may be used in other applications. Transactions made elsewhere can change the balance and position Aura reads, and they do not pass through Aura's policy controls.

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

Historical value is shown only for days with complete wallet activity, protocol coverage, and independent price evidence. Choose 7, 30, or 90 completed UTC days. Aura does not calculate an inception return from these windows. Missing days appear as gaps; current balances are not substituted for them. The daily price source currently covers ETH and USDC on Base. Other assets and incomplete Aave position history can leave gaps.

If source history is being rebuilt, or a source has advanced beyond the last calculation, the prior chart value is hidden until a fresh calculation is published. Tax-support rows are likewise unavailable while their source evidence is stale. A documented acquisition or sale can support a tax lot without a daily closing price, but the export is not tax advice and may be incomplete.

## DeFi positions

Portfolio reads the active wallet's Aave V3 position directly from Aave and Base. It shows the source-reported active-market count, health factor, and net position when those fields are available.

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

Exporting a wallet gives the customer more portability and more direct responsibility. Once used elsewhere, Aura cannot enforce its destination rules, cooling periods, account lock, or transaction review.

## Deposits

The wallet address may accept many EVM tokens that Aura does not support. Check the exact network and asset contract before sending. Aura does not automatically recover assets sent through the wrong network or contract.

For a first deposit, start with a small amount and verify it on BaseScan before sending more.

:::note[Public activity]
The balance-privacy setting only hides numbers on your screen. It does not hide transactions or balances on a public blockchain.
:::

## No deposit insurance claim

Onchain wallet assets and DeFi positions are not bank deposits merely because Aura presents them in a bank-like interface. Unless a specific future regulated product says otherwise in its own terms, do not assume deposit insurance, chargeback rights, or bank-style reversibility.
