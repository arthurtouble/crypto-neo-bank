---
title: Swap
description: Find assets, compare live routes, and understand what is available before moving money.
---

Swap lets you search supported digital assets by name or contract address. The search includes Base, Ethereum, Arbitrum, Optimism, and Polygon. If two assets share a name, their network and contract address help you tell them apart. Search results are not an endorsement or permission to trade.

## Find an asset

Select **You Pay** or **You Receive**, then search by name, symbol, or contract address. A verified label means Aurel has reviewed that exact contract. Other contracts are marked **Unverified** and require an explicit address check before a quote request. An asset can disappear from search or quoting if its source data is unavailable or its status changes.

Markets prices and Swap routes come from different sources. A market opens Swap only when Aurel has mapped that market to a specific contract and confirmed that the asset remains visible. A price on Markets is not an executable quote.

Markets search checks the full USD market list returned by its price source before paging results; it is not limited to the page already on screen. This list and the LI.FI Swap catalog are different universes, so appearing in Markets does not guarantee a route.

If live asset search cannot connect, Swap shows only the reviewed Base USDC and WETH contracts and labels the list as limited. Other assets do not become available from cached names or symbols. A live route is still required before you can trade.

## Review a route

Enter the amount, choose a slippage limit, and select **Find Route**. When a route is available, Aurel shows the minimum received, estimated fees and price impact when available, and whether the route crosses networks. Quotes expire quickly. If one expires, find a new route before continuing. A missing estimate is shown as unavailable, not zero.

You may see a route preview before Swap trading is available for your account. In that case, Aurel shows the route and its estimate but does not offer **Review Swap** or a wallet request. A preview is not an order and does not reserve a price.

LI.FI supplies cross-network and broader asset route data. For Base USDC and WETH, Aurel can also quote the reviewed Uniswap V3 pool directly. The first reviewed cross-network route is native USDC from Base to Arbitrum. Aurel checks the asset contracts, wallet, amount, recipient, minimum received, expiry, fees, and exact transaction call before asking for a signature. Other route shapes may appear in search but remain unavailable for confirmation until reviewed.

## Before you confirm

**Review Swap** checks the route against your account controls. If the route passes, Aurel prepares the exact wallet request and shows **Confirm Swap**. When you confirm, Aurel checks the route and your account controls again before opening your wallet. If anything has changed or the quote has expired, find a new route. Your wallet asks you to approve the request; Aurel cannot sign it for you. A quote, a successful review, and a wallet request are not completed trades. After broadcast, the transaction remains pending until its on-chain result is verified.

If a token needs approval, your wallet asks you to approve only the amount for this trade. This is a separate transaction; it does not submit the swap. Some tokens need an existing approval reset to zero first. Before opening your wallet, Aurel checks that the approval still matches your route and that your account can proceed. If anything changed, you need a new route. After the approval is confirmed, find a new route—Aurel never reuses the old quote. An approval may remain on chain if the swap fails or is never submitted, and you can revoke it separately. Finding a route does not mean it can be traded.

Swap confirmation is subject to account eligibility and availability. It is not currently enabled for customers.

You can save a recurring Swap reminder. When it is due, Aurel can show it in the app and take you back to a fresh route review. It does not reuse an old quote or sign for you. You can also save an ETH/USD price-alert preference, but price checking and delivery are not active yet; saving an alert is not a promise that you will be notified. Neither a reminder nor an alert is an order.

Cross-network delivery needs separate destination evidence. A successful source transaction alone does not prove that the received asset arrived. Aurel checks the routing provider's status against finalized transactions on both networks and the amount credited to your wallet. If delivery is delayed, partial, refunded, or cannot be verified, the swap stays unresolved and is flagged for review. Do not send it again just because the destination balance has not updated.

## What can change

Liquidity, price, fees, token behavior, and route availability can change between review and execution. A route may include independent contracts and services. Check the asset contract and amount carefully; a matching name or logo is not proof of safety. Aurel's database records review and verification evidence, but balances and settlement remain with wallets, networks, and contracted providers.
