---
title: Swap
description: "Swap between crypto, stablecoins, stocks, and gold on Base or to another network: the quote, what it costs, how far the price can move, and when a swap is complete."
---

Swap exchanges one supported asset for another, on the same network or between networks: crypto, the euro stablecoin, [stocks](/product/tokenized-stocks-and-gold/), and Tether Gold.

You pay with an asset on Base, or Tether Gold on Ethereum. You can receive any supported asset, on Base or another supported network. Aura finds the price across independent exchanges and transfer services.

## Before you confirm

The quote shows what you pay and get in dollars, the rate, the fees, and any price difference.

- You can swap up to your balance. Aura checks it before it gets a quote.
- A quote lasts 45 seconds. After that, get a new one.
- The asset lists are grouped like your Overview: Cash, Crypto, Stocks, and Metals. Stocks are listed by company name, such as Apple (AAPLc).
- The rate is priced in cash when one side is cash, so buying and selling Apple both show "1 AAPLc = … USDC".
- **Fees** are what the exchange, and any transfer to another network, charge. **Price difference** is what your amount loses to the market: the dollar value you pay, minus the dollar value you get, minus the fees. Nobody charges it, so it has its own line, and it's left out when there is none. Both are already taken out of what the quote says you receive.
- Aura pays the network fee on the network you pay from.
- **Price can move up to** sits in the quote, next to the least you get. It's 0.5% unless you pick 0.1% or 1%, and picking another value refreshes the quote. On the same network, if the price moves further before the swap goes through, the swap stops and what you paid with stays in your account.
- If you're somewhere stocks can't be bought, such as the United States or the United Kingdom, Swap says so before you get a quote. You can still sell or send the stocks you hold.
- You can only swap assets on Aura's reviewed list. If your amount would cost more than 3% because the market can't take it at a fair price, Aura tells you and suggests a smaller amount.
- For stocks and gold, the quote also shows the market price and when it was published. Stock markets close at night, at weekends, and on holidays, but the tokens still trade. If the quote is more than 2% away from the market price, Aura tells you.
- Aura keeps the quote on its server. Your account approves only a transaction to the contract of LI.FI, the service that carries out the swap.

If the swap needs a token approval, the approval and the swap are sent together, as one operation. The approval covers this swap only.

## After you confirm

Aura checks the blockchain itself. A swap is complete when the transaction matches what you reviewed and at least the minimum amount arrived.

- **On Base**, that's once it's in a block and Aura finds what you received, usually within seconds. Base makes it final about 20 minutes later.
- **To another network**, the asset goes to your address on that network. Aura only shows and moves balances on Base, and Tether Gold on Ethereum, so anything else you receive on another network won't show in Aura. Use a wallet that supports that network to see or move it. The quote says so before you confirm.
- **Tracking a move to another network:** it shows as sent once it leaves your account; you can close it and follow the rest in Transactions. The first network confirming isn't enough: Transactions shows it as **Pending** until the asset arrives, usually within 30 minutes. Selling Tether Gold works the same way, from Ethereum to Base.

Prices and fees can change. Your wallet and the blockchain have the final word on your balance. [See what's available now](/getting-started/status/).
