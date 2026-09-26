---
title: Swap
description: How Aura quotes, checks, and completes swaps.
---

Swap exchanges one supported asset for another, on the same network or between networks. Invest uses the same routes to buy crypto assets.

Aura asks LI.FI for a route. LI.FI is an independent service that chooses among third-party bridges and exchanges. Aura shows you the rate, the fees, and the price impact before you confirm.

## Before you confirm

- A quote lasts 45 seconds. After that, get a new one.
- You choose the slippage: 0.1%, 0.5%, or 1%. If you would get less than the minimum, the swap fails instead.
- You can only swap assets on Aura's reviewed list, and Aura won't use a route with price impact above 3%.
- Aura keeps the quote on its server. Your account approves only a transaction to LI.FI's contract.

If the swap needs a token approval, the approval and the swap are sent together, as one operation. The approval covers this swap only.

## After you confirm

Aura checks the blockchain itself. A swap is complete when the transaction matches what you reviewed and at least the minimum amount arrived.

For a swap between networks, the first network confirming isn't enough. Aura shows it as **On its way** until the asset arrives on the other network.

Prices, fees, and liquidity can change. Your wallet and the blockchain have the final word on your balance. [See what's available now](/getting-started/status/).
