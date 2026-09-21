---
title: Wallets and assets
description: How Aurel shows ownership, balances, and wallet authority.
sidebar:
  order: 1
---

## Wallet authority

Privy provides Aurel’s sign-in and embedded-wallet infrastructure. You can also connect an external EVM wallet. Aurel does not hold a private key that can move your assets on its own.

When you take an action, Aurel prepares and checks the transaction. Your wallet then shows the final request. You can sign or cancel it.

An embedded wallet is not an Aurel company wallet. Wallet creation, signing, recovery, and export follow the configured Privy model. Aurel receives the public wallet reference and verified customer identity needed to provide the product.

An external wallet may be used in other applications. Transactions made elsewhere can change the balance and position Aurel reads, and they do not pass through Aurel's policy controls.

## Where balances come from

The chain is the final record for onchain assets. Aurel can cache or format that data for the interface, but an Aurel database value does not override the chain.

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

## Wallet recovery

Recovery and export follow Privy’s customer controls. Aurel support will never ask for a seed phrase, private key, recovery secret, or one-time code.

Before relying on a wallet for significant value:

1. confirm the recovery methods shown by Privy;
2. secure the email, device, passkey, or social account involved;
3. understand how export changes the security boundary;
4. test access from a recovery scenario with a small balance;
5. keep public wallet addresses separate from private recovery material.

Exporting a wallet gives the customer more portability and more direct responsibility. Once used elsewhere, Aurel cannot enforce its destination rules, cooling periods, account lock, or transaction review.

## Deposits

The wallet address may accept many EVM tokens that Aurel does not support. Check the exact network and asset contract before sending. Aurel does not automatically recover assets sent through the wrong network or contract.

For a first deposit, start with a small amount and verify it on BaseScan before sending more.

:::note[Public activity]
The balance-privacy setting only hides numbers on your screen. It does not hide transactions or balances on a public blockchain.
:::

## No deposit insurance claim

Onchain wallet assets and DeFi positions are not bank deposits merely because Aurel presents them in a bank-like interface. Unless a specific future regulated product says otherwise in its own terms, do not assume deposit insurance, chargeback rights, or bank-style reversibility.
