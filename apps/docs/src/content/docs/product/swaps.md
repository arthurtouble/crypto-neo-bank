---
title: Swap
description: Find assets, compare live routes, and understand what is available before moving money.
---

Swap lets you search supported digital assets by name or contract address. The search includes Base, Ethereum, Arbitrum, Optimism, and Polygon. If two assets share a name, their network and contract address help you tell them apart. Search results are not an endorsement or permission to trade.

## Find an asset

Select **You Pay** or **You Receive**, then search by name, symbol, or contract address. A verified label means Aurel has reviewed that exact contract. Other contracts are marked **Unverified** and require an explicit address check before a quote request. An asset can disappear from search or quoting if its source data is unavailable or its status changes.

Markets prices and Swap routes come from different sources. A market opens Swap only when Aurel has mapped that market to a specific contract and confirmed that the asset remains visible. A price on Markets is not an executable quote.

Markets search checks the full USD market list returned by its price source before paging results; it is not limited to the page already on screen. This list and the LI.FI Swap catalog are different universes, so appearing in Markets does not guarantee a route.

## Review a route

Enter the amount, choose a slippage limit, and select **Find Route**. When a route is available, Aurel shows the minimum received, estimated fees and price impact when available, and whether the route crosses networks. Quotes expire quickly. If one expires, find a new route before continuing. A missing estimate is shown as unavailable, not zero.

LI.FI currently supplies route data. Aurel checks the requested assets, amount, wallet, networks, top-level transaction target, approval spender, and expiry against its own controls. For the supported Base fee-plus-swap shape, it also compares the displayed amount, fee, recipient, and minimum received with the route's encoded transaction. Aurel returns quote details without exposing a raw provider transaction for the browser to sign. Only configured route tools and top-level targets may pass the preview check; nested contracts still need separate review before execution.

## Before you confirm

**Review Swap** checks the route against your account controls. If the route passes, Aurel prepares the exact wallet request and shows **Confirm Swap**. Your wallet asks you to approve that request; Aurel cannot sign it for you. A quote, a successful review, and a wallet request are not completed trades. After broadcast, the transaction remains pending until its on-chain result is verified.

Some routes cannot be confirmed yet. A token may need an approval, or a route may use a contract Aurel has not cleared for execution. In either case, the app will not ask your wallet to sign that swap. Across-network swaps are not available for confirmation yet. Finding a route does not mean it can be traded.

Swap confirmation is subject to account eligibility and availability. It is not currently enabled for customers.

You can save a recurring Swap reminder. When it is due, Aurel can show it in the app and take you back to a fresh route review. It does not reuse an old quote or sign for you. You can also save an ETH/USD price-alert preference, but price checking and delivery are not active yet; saving an alert is not a promise that you will be notified. Neither a reminder nor an alert is an order.

Cross-network delivery needs separate destination evidence. A successful source transaction alone does not prove that the received asset arrived.

## What can change

Liquidity, price, fees, token behavior, and route availability can change between review and execution. A route may include independent contracts and services. Check the asset contract and amount carefully; a matching name or logo is not proof of safety. Aurel's database records review and verification evidence, but balances and settlement remain with wallets, networks, and contracted providers.
