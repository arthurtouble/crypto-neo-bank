---
title: Swap
description: How Aura quotes, checks, and completes swaps.
---

Swap exchanges one supported asset for another, on the same network or between networks: crypto, the euro stablecoin, tokenized stocks, and Tether Gold.

You pay with an asset on Base, or Tether Gold on Ethereum. You can receive any supported asset, on Base or another supported network. Aura gets the route from LI.FI, an independent service that chooses among third-party bridges and exchanges.

## Before you confirm

The review shows the rate, the fees, and the price impact.

- A quote lasts 45 seconds. After that, get a new one.
- You choose the slippage: 0.1%, 0.5%, or 1%. If you would get less than the minimum, the swap fails instead.
- You can only swap assets on Aura's reviewed list. If a route would lose more than 3% to price impact, Aura tells you and suggests a smaller amount.
- Aura pays the network fee on the network you pay from. Route fees come out of the amount.
- For stocks and gold, the quote also shows a reference price and when it was published. Stock markets close at night, at weekends, and on holidays, but the tokens still trade. If the quote is more than 2% away from the reference, Aura tells you.
- Aura keeps the quote on its server. Your account approves only a transaction to LI.FI's contract.

If the swap needs a token approval, the approval and the swap are sent together, as one operation. The approval covers this swap only.

## After you confirm

Aura checks the blockchain itself. A swap is complete when the transaction matches what you reviewed and at least the minimum amount arrived.

- **On Base**, that's once it's in a block and Aura finds what you received, usually within seconds. Base makes it final about 20 minutes later.
- **To another network**, it shows as sent once it leaves your account; you can close it and follow the rest in Transactions. The first network confirming isn't enough: Aura shows it as **On its way** until the asset arrives, usually within 30 minutes. Selling Tether Gold works the same way, from Ethereum to Base.

Prices, fees, and liquidity can change. Your wallet and the blockchain have the final word on your balance. [See what's available now](/getting-started/status/).
