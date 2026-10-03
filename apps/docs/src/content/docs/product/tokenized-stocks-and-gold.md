---
title: Tokenized stocks and gold
description: The tokenized stocks and gold Aura supports, what a token gives you, and how prices work.
---

Aura supports ten tokenized stocks issued by Coinbase on Base, and Tether Gold. You can hold them, send them, and buy or sell them through Swap. They show in Overview under **Stocks** and **Metals**.

| Asset | Token | Network |
| --- | --- | --- |
| Apple | AAPLc | Base |
| Amazon | AMZNc | Base |
| Alphabet | GOOGLc | Base |
| Meta Platforms | METAc | Base |
| Microsoft | MSFTc | Base |
| Strategy | MSTRc | Base |
| NVIDIA | NVDAc | Base |
| Sandisk | SNDKc | Base |
| SpaceX | SPCXc | Base |
| Tesla | TSLAc | Base |
| Tether Gold | XAUt | Ethereum |

Aura identifies each one by its network and contract address, not its ticker.

## What a tokenized stock is

A Coinbase tokenized stock is a token on Base that tracks a US company's shares. It isn't a share in your name.

- **One token isn't always one share.** For dividends and splits, Coinbase changes a multiplier instead of your token balance. Over time, one token can stand for more or less than one share.
- **Who can buy them.** Coinbase says its tokenized stocks are only for people in eligible places outside the US. Aura doesn't let you buy them from the United States or the United Kingdom. You can still sell or send ones you hold.
- **Transfers can be blocked.** The issuer can block transfers to or from some addresses, such as sanctioned ones. A blocked send fails and nothing moves.
- **Buying and selling.** You trade the token with other holders through Swap, at the market's price. Only Coinbase's approved partners can create or redeem tokens for real shares.

## What Tether Gold is

One XAUt is backed by one troy ounce of physical gold held for Tether. It's issued on Ethereum, so your account holds it there, at the same address as on Base. Buying it moves your money from Base to Ethereum through LI.FI; the route's fees come out of the amount. Aura pays the Ethereum network fee when you send or sell it.

## Prices

Aura values stocks and gold with Chainlink price feeds.

- **Stocks** follow US market hours. At night, at weekends, and on holidays, the feed holds the last price. The price is the token's total-return value: the share price with the token's multiplier applied.
- **Gold** uses Chainlink's gold price. Tether Gold usually trades close to it.
- Overview shows when each price was published, for example "Price as of Fri 4:00 PM".
- If a price is more than four days old, Aura shows the value as unavailable rather than an old number.

## Risks

Prices can move quickly, and markets for these tokens can be thinner than for the shares or gold themselves. The issuer, the network, and the route you trade through each add their own risk. See the [risk disclosure](/legal/risk-disclosure/).
