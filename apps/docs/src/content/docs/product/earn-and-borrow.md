---
title: Earn and borrow
description: How Aurel presents Aave positions and the risks behind them.
sidebar:
  order: 3
---

Aurel connects to Aave V3 on Base. Rates and positions come from Aave data. Transactions go to Aave contracts and require your wallet signature.

## Earn

Supplying an asset creates exposure to the Aave protocol. The displayed annual percentage yield is variable. It is not a bank deposit rate, guaranteed return, or insured balance. Withdrawals depend on market liquidity.

## Borrow

Borrowing creates debt against collateral. Prices, rates, and your health factor can change quickly. If your position crosses Aave’s liquidation boundary, the protocol can liquidate collateral automatically. Aurel cannot pause or reverse that process.

## Before you sign

Review the asset, amount, network, contract, expected change, health factor, approval amount, and gas cost. Keep enough ETH on Base for future transactions.

Smart contracts, oracles, governance, liquidity, stablecoins, and Base can fail or behave unexpectedly. A preview helps you make a decision; it is not a promise of the outcome.

## Position data

Aurel reads Aave market and customer-position data from Aave's interfaces and contracts. The protocol remains authoritative. Rates, collateral values, debt, available liquidity, and health factor can change between display, signature, and settlement.

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
- Liquidation can happen automatically and cannot be reversed by Aurel.
- Tax and legal treatment can differ by country and action.

Aurel does not choose a position for the customer or promise that protocol yield compensates for these risks.
