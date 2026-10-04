---
title: Earn
description: Earn a variable return on Base with Aave and two Morpho USDC vaults.
---

Earn has three options, all on Base:

- **Aave USDC.** Aave lends your USDC to borrowers. Withdraw it when you like.
- **Steakhouse Prime USDC.** A Morpho vault managed by Steakhouse Financial.
- **Gauntlet USDC Prime.** A Morpho vault managed by Gauntlet.

Aura doesn't hold your deposit; every position stays in your own account. Aave and Morpho set the rates, and your balance is what Base records. Earn is switched off until it has been tested with real funds.

## How the Morpho vaults work

A vault lends your USDC across several Morpho lending markets. The vault's manager chooses the markets and how much goes to each. You get vault shares, which Aura shows as their value in USDC.

Neither vault charges a fee. We reviewed each vault before listing it. Before every deposit or withdrawal, Aura checks that the vault still takes USDC and that no one has limited who can use it. If either has changed, Aura pauses the vault until it's reviewed again.

## How returns work

Each option shows its current rate and your position. A rate is today's rate, not a forecast. It moves with supply and demand and can fall to zero. If Aura can't load a rate, or its latest refresh failed, it shows the rate as unavailable, never an older number. **Try again** loads it again.

None of these is a bank deposit, insured, or guaranteed.

## Depositing and withdrawing

You confirm each deposit or withdrawal once, with your passkey; any token approval happens in the same step. Check the option, asset, and amount before you confirm.

- You need enough USDC in your account to deposit, and enough in the position to withdraw. Aura checks both before you confirm.
- Aave WETH no longer takes deposits. If you supplied WETH before, it shows on Earn so you can withdraw it.
- **Withdraw all** empties an Aave or Morpho position completely, including interest earned up to that moment.
- Aura pays the network fee. Earn moves money between your own positions, so it doesn't count toward your daily limit.
- Aura marks a deposit or withdrawal complete only after it sees Aave's or Morpho's own record of it on Base.

Withdrawing depends on how much is available to withdraw. If there isn't enough for your amount right now, the withdrawal fails and nothing moves. Try a smaller amount, or try again later.

## Your positions

Positions show in three places: the Earn group on Overview, **Your positions** at the top of Earn, and the option you hold. Open an option to deposit or withdraw: the **Deposit** tab shows how much you have in your account, with **Max**, and the **Withdraw** tab shows how much is in that position.

Aura reads each position from the blockchain and shows its value in dollars as last read, with its current yearly rate: Aave's rate, or for a vault, Morpho's net rate after any fee. Interest shows up at the next read.

If Aura can't read a position, it shows it as unavailable, never as zero. If it can't load the rate, the position shows **Rate unavailable**.

Smart contracts, price feeds, curators, governance, stablecoins, liquidity, and networks can fail or change. See the [risk disclosure](/legal/risk-disclosure/).
