---
title: Swap
description: How Aura quotes, checks, and completes swaps.
---

Swap moves any supported asset to another, on the same network or across networks. Aura asks LI.FI for a route and shows you the rate, fees, and price impact.

## Before you sign

- A quote lasts 45 seconds. After that, get a new one.
- You choose the slippage: 0.1%, 0.5%, or 1%. The route fails rather than deliver less than the minimum.
- Aura refuses a route whose price impact is above 3%, or above 1% when an asset is unverified.
- Aura keeps the quote on its server. Your wallet only signs a transaction sent to LI.FI's contract.

If the swap needs a token approval, the approval and the swap are signed together, as one operation. The approval covers only this swap.

## After you sign

Aura checks the chain itself. A swap is complete when the operation matches what you reviewed and at least the minimum output arrived. For a cross-network swap, the first network confirming is not enough. Aura shows it as on its way until the asset arrives on the other network.

Prices, fees, and liquidity can change. The wallet and chains remain authoritative for balances. [Check current availability](/getting-started/status/) before relying on a route.
