---
title: Earn
description: Earn a variable return on Base with Aave and two Morpho USDC vaults.
sidebar:
  order: 3
---

Earn has four options, all on Base:

- **Aave USDC.** Supply USDC to Aave's lending market and withdraw it when you like.
- **Aave WETH.** Supply WETH to the same market.
- **Steakhouse Prime USDC.** A Morpho vault curated by Steakhouse Financial.
- **Gauntlet USDC Prime.** A Morpho vault curated by Gauntlet.

Aura doesn't hold your deposit; the position stays in your own account. The protocol and the network decide balances, rates, and settlement. Earn is switched off until it has been tested with real funds.

## How the Morpho vaults work

A vault lends your USDC across several Morpho lending markets. The curator chooses the markets and how much goes to each. You get vault shares, which Aura shows as their value in USDC.

Neither vault charges a fee. We reviewed each vault before listing it. Before every deposit or withdrawal, Aura checks that the vault still takes USDC and that no one has limited who can use it. If either has changed, Aura pauses the vault until it's reviewed again.

## How returns work

Each option shows its current rate, how much can be withdrawn now, and its total deposits. A rate is today's rate, not a forecast. It moves with supply and demand and can fall to zero. If Aura can't read a rate, it shows it as unavailable.

None of these is a bank deposit, insured, or guaranteed.

## Depositing and withdrawing

You confirm each deposit or withdrawal once, with your passkey; any token approval happens in the same step. Check the option, asset, and amount in the review first.

- You need enough USDC or WETH in your account to deposit, and enough in the position to withdraw.
- **Withdraw all** empties a Morpho vault position completely.
- Aura pays the network fee. Earn moves money between your own positions, so it doesn't count toward your daily limit.
- Aura marks a deposit or withdrawal complete only after it sees the protocol's own record of it on the blockchain.

Withdrawing depends on the lending markets having enough available. If a market can't release your amount, the withdrawal fails and nothing moves. Try a smaller amount, or try again later.

## Your positions

Positions show in three places: the Earn group on Overview, **Your positions** at the top of Earn, and each market or vault. Open a market or vault to deposit or withdraw.

Aura reads each position from the blockchain, then shows it growing live, to 8 decimals, at its current yearly rate: Aave's rate, or for a vault, Morpho's net rate after any fee. The live number is an estimate between reads; each new read replaces it.

If Aura can't read a position, it shows it as unavailable, never as zero. If it can't read the rate, the position shows the amount read, without growing.

Smart contracts, price feeds, curators, governance, stablecoins, liquidity, and networks can fail or change. See the [risk disclosure](/legal/risk-disclosure/).
