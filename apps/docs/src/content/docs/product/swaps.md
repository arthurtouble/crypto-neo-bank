---
title: Swaps and live quotes
description: How Aurel compares executable swap routes, handles approvals, and keeps the final decision with you.
---

Aurel lets you exchange a curated set of digital assets from one familiar **Swap** screen. The app compares live executable quotes and keeps networks and router contracts out of the main flow unless you open the technical details.

## Supported assets

The initial curated list includes ETH, USDC, WETH, cbBTC, WBTC, cbETH, wstETH, EURC, DAI, USDS, LINK, and AAVE. This is an allowlist, not every token returned by a public token directory. Aurel checks the asset address, decimal precision, settlement network, and transaction target before returning a quote.

Market data and swap availability are separate. Seeing an asset in **Markets** does not mean it is eligible for execution.

## Comparing quotes

When you choose **Review Quotes**, Aurel requests provider-specific routes through LI.FI and shows only the routes that are executable at that moment. The result can include 1inch, KyberSwap, SushiSwap, and Nordstern. Unavailable routes are omitted rather than replaced with an estimate.

Each row shows:

- the route provider;
- the minimum amount you should receive after slippage;
- an available network-fee estimate; and
- whether the route currently offers the best output.

Quotes expire after 45 seconds. A stale quote cannot be submitted; you must compare again.

## Approval and confirmation

An ERC-20 asset may require a token approval before the swap. Aurel requests approval for the exact amount of the current swap, not an unlimited amount. The approval and the swap are separate wallet confirmations.

Before the swap request reaches the wallet, Aurel applies the same account-lock, rolling-limit, step-up, and large-action review policy used by other outgoing actions. The wallet then shows the final request. Cancelling either confirmation leaves the swap unsubmitted.

## Source of truth

The live quote provider is authoritative for the route at quote time. The selected contracts and the settlement chain are authoritative for execution and final balances. Aurel records workflow status and reconciliation evidence, but its operational database is not a ledger and cannot create a balance or complete a swap.

## Important risks

Prices, liquidity, fees, and price impact can change quickly. A displayed minimum includes the route's slippage setting, but it does not eliminate smart-contract, market, asset, wallet, or settlement risk. Review the asset pair, amount, minimum received, provider, and wallet request before confirming.
