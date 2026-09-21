---
title: Wallets and assets
description: How Aurel shows ownership, balances, and wallet authority.
sidebar:
  order: 1
---

## Wallet authority

Privy provides Aurel’s sign-in and embedded-wallet infrastructure. You can also connect an external EVM wallet. Aurel does not hold a private key that can move your assets on its own.

When you take an action, Aurel prepares and checks the transaction. Your wallet then shows the final request. You can sign or cancel it.

## Where balances come from

The chain is the final record for onchain assets. Aurel can cache or format that data for the interface, but an Aurel database value does not override the chain.

The main asset view currently reads:

| Asset | Network | Source |
| --- | --- | --- |
| ETH | Base | Native balance |
| USDC | Base | Token contract |
| WETH | Base | Token contract |

## Wallet recovery

Recovery and export follow Privy’s customer controls. Aurel support will never ask for a seed phrase, private key, recovery secret, or one-time code.

:::note[Public activity]
The balance-privacy setting only hides numbers on your screen. It does not hide transactions or balances on a public blockchain.
:::
