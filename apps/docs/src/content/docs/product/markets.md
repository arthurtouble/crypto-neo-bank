---
title: Markets
description: "Trade perps on Hyperliquid and prediction markets on Polymarket from Aura: who holds your money, what you pay, and what you can lose."
---

Markets lets you trade on two independent venues from Aura: perps on Hyperliquid, and predictions on Polymarket. Markets isn't available yet. [See what's available now](/getting-started/status/).

These are third-party markets, not Aura products. You can lose some or all of what you put in. Aura doesn't give investment advice.

## Who holds your money

Your Aura wallet owns your account on each venue. Aura never holds your money there and can't withdraw it.

- **Perps.** Your account on Hyperliquid belongs to your wallet's address. The first time you trade, you approve a trading key with your passkey. It places and cancels orders for you, but Hyperliquid never lets it withdraw or move money out of your account.
- **Predictions.** Your account on Polymarket is a wallet that your Aura wallet owns. You confirm each order with your passkey.
- Only your wallet can withdraw. Money you withdraw comes back to your Aura account as USDC on Base.

## Fees

Aura charges no fee on Markets. Each venue charges its own trading fees. Circle's fee for moving USDC to Hyperliquid comes out of the amount, and the review shows it.

## Perps

A perp follows the price of an asset, such as bitcoin or a stock. You don't own the asset. You choose long, if you think the price will rise, or short, if you think it will fall.

- **Amount and leverage.** You put in a dollar amount and choose leverage, up to each market's maximum. At 5x, $20 controls a $100 position.
- **Liquidation.** If the price moves against you far enough, Hyperliquid closes your position and you lose the money behind it. The order sheet shows an estimated liquidation price before you confirm. With leverage, a small price move can wipe out what you put in.
- **Isolated or cross.** Isolated risks only the money behind this position. Cross can use your whole perps balance to keep positions open.
- **Market or limit.** A market order fills now, near the current price. A limit order waits for your price.
- **Auto-close.** You can set a take profit price and a stop loss price, when you place the order or later.
- **Funding.** Every hour, longs and shorts pay each other a small funding rate. Each market's page shows it.

If your perps balance is short, Aura adds the difference from your USDC on Base first. The first deposit is at least $6, because Hyperliquid needs at least $5 to arrive. It usually takes seconds.

## Predictions

Each market asks a question, such as whether a bill passes by a date. You buy shares in an outcome. Each share pays $1 if that outcome happens, and nothing if it doesn't.

- **Price.** A share's price, in cents, is roughly the market's chance of that outcome. At 64¢, $10 pays about $15.63 if it wins. The price can move before your order fills.
- **Results.** Polymarket decides each result after the market ends, from the source named on the market's page.
- **Selling and collecting.** You can sell shares before the market ends. Once it resolves, collect your winnings.

The first time, you confirm a few setup steps with your passkey. Aura then adds the money from your USDC on Base and places the order.

Sports markets aren't offered.

## Prices and balances

Prices, balances, and positions come straight from Hyperliquid and Polymarket, with the time they were read. If Aura can't read them, it says so instead of showing an old number.

Related: [risk disclosure](/legal/risk-disclosure/), [fees](/company/fees-and-alignment/).
