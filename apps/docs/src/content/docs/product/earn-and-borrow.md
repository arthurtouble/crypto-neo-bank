---
title: Earn and borrow
description: How Aura presents Aave positions and the risks behind them.
sidebar:
  order: 3
---

Aura shows Aave V3 markets and positions using protocol data. Supplying, withdrawing, borrowing, repaying, and claiming rewards are currently read-only in Aura. We will enable signing only after the transaction plan, contract checks, account controls, and settlement verification have been independently tested. Until then, Aura will not ask you to sign an Aave transaction.

## Earn

Supplying an asset creates exposure to the Aave protocol. The displayed annual percentage yield is variable. It is not a bank deposit rate, guaranteed return, or insured balance. Withdrawals depend on market liquidity.

## Borrow

Borrowing creates debt against collateral. Prices, rates, and your health factor can change quickly. If your position crosses Aave’s liquidation boundary, the protocol can liquidate collateral automatically. Aura cannot pause or reverse that process.

## Claimable rewards

Portfolio checks Aave's rewards interface for claimable rewards on the supported settlement network. A displayed reward amount and USD value come from Aave at the observation time; Aura does not calculate or promise them.

Claiming rewards is not available in Aura yet. A displayed amount is an observation, not a payment or a promise that it can be claimed here.

Some Aave reward programmes span networks or use external incentive systems. Aura only displays the supported network result in this workspace. A missing or unavailable source is not shown as an earned amount.

## Before using a protocol

Review the asset, amount, contract, expected change, health factor, approval amount, and network fee in your wallet before using a protocol. Keep enough native currency for future transactions. Aura's position preview is informational; it is not a transaction simulation or a guarantee of execution.

Smart contracts, oracles, governance, liquidity, stablecoins, and Base can fail or behave unexpectedly. A preview helps you make a decision; it is not a promise of the outcome.

## Position data

Aura reads Aave market and customer-position data from Aave's interfaces and contracts. The protocol remains authoritative. Rates, collateral values, debt, available liquidity, and health factor can change between display, signature, and settlement.

## Supplying

Supplying transfers an asset into the protocol and creates a protocol position. The displayed APY is an annualized variable rate based on current conditions, not a fixed offer. Rewards, if any, can have separate eligibility and token risk.

Withdrawing depends on the customer's position and available market liquidity. Collateral that supports debt may not be withdrawable without first improving the position.

## Borrowing

The amount a customer can borrow depends on collateral parameters, prices, existing debt, and protocol rules. Borrowed assets accrue interest. Variable rates can rise quickly.

Health factor is a simplified risk indicator, not a safety guarantee. A sudden price move, oracle update, interest accrual, or parameter change can lead to liquidation before a customer reacts.

## Repaying

Repayment can require a token approval followed by the protocol transaction. The amount needed to clear a variable debt can change while the transaction is pending. A small residual balance may remain if the prepared amount no longer matches accrued debt.

## Approvals

An ERC-20 approval authorizes a contract to spend a token. Review the spender and amount in the wallet. Exact or limited approvals reduce exposure compared with unlimited approvals, but the approved protocol contract still presents risk.

## Risk checklist

- Smart-contract code or upgrades can fail.
- Governance can change supported parameters.
- Oracles can be delayed, manipulated, or behave unexpectedly.
- Stablecoins and collateral can lose value.
- Market liquidity can make withdrawal difficult.
- Base can become congested or unavailable.
- Liquidation can happen automatically and cannot be reversed by Aura.
- Tax and legal treatment can differ by country and action.

Aura does not choose a position for the customer or promise that protocol yield compensates for these risks.
