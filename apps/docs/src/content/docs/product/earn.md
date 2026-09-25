---
title: Earn
description: Earn a variable return with Aave on Base and Sky savings on Ethereum.
sidebar:
  order: 3
---

Earn lets you put assets to work in two independent protocols:

- **Aave on Base.** Supply a supported asset to Aave's lending market and withdraw it when you like.
- **Sky savings on Ethereum.** Deposit USDC, which becomes sUSDS, Sky's savings token. When you withdraw, it turns back into USDC. Aura uses Spark's conversion contract for this.

Aura doesn't hold your deposit. It stays in your wallet's position with the protocol. The protocol and the network decide balances, rates, and settlement. Earn is switched off until it has been tested with real funds.

## How returns work

Aave's rate moves with supply and demand. Sky's savings rate can also change. Either can fall to zero.

Neither is a bank deposit, insured, or guaranteed. Getting your money out depends on the protocol working and having enough available to withdraw.

## Depositing and withdrawing

Any token approval and the deposit are signed together, as one operation. Check the asset, amount, and network in your wallet before you sign.

Aura marks a deposit or withdrawal complete only after it sees the protocol's own record of it on the blockchain.

Sky runs on Ethereum. To use it with USDC on Base, first move your USDC to Ethereum with Swap. Wait until that move shows complete.

## Rewards and position data

If Aave reports rewards you can claim, Aura shows them. You can't claim them in Aura yet. A reward on screen isn't a payment.

Previews help you decide. They don't guarantee the result. Smart contracts, price feeds, governance, stablecoins, liquidity, and networks can fail or change. If Aura can't read a position, it shows it as unavailable, never as zero.

See the [risk disclosure](/legal/risk-disclosure/).
