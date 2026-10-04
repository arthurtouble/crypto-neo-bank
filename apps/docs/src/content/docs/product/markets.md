---
title: Perps and predictions
description: "Trade perps on Hyperliquid and prediction markets on Polymarket from Aura: who holds your money, what you pay, and what you can lose."
---

Aura lets you trade on two independent venues: perps on Hyperliquid, in the Perps section, and predictions on Polymarket, in the Predictions section. Neither is available yet. [See what's available now](/getting-started/status/).

These are third-party markets, not Aura products. You can lose some or all of what you put in. Aura doesn't give investment advice.

## Who holds your money

Your Aura wallet owns your account on each venue. Aura never holds your money there and can't withdraw it.

- **Perps.** Your account on Hyperliquid belongs to your wallet's address. The first time you trade on a device, you approve a trading key with your passkey. The key stays on that device: Aura never has it, so only you can place, change, or close trades. Hyperliquid never lets it withdraw or move money out of your account. Each new device asks for your passkey once.
- **Predictions.** Your account on Polymarket is a wallet that your Aura wallet owns. You confirm each order with your passkey.
- Only your wallet can withdraw. Money you withdraw comes back to your Aura account as USDC on Base.

## Fees

Aura charges no fee on perps or predictions. Each venue charges its own trading fees. Moving USDC to your perps balance costs a network fee of a few cents, which comes out of the amount; the steps show it.

## Where they work

Perps follow Hyperliquid's terms, so they aren't available in the United States or Ontario. Predictions follow Polymarket's rules, so they aren't available where Polymarket doesn't take new orders, such as the United States, the United Kingdom, France, Germany, Australia, and Singapore, and they aren't available in the United Arab Emirates. From those places you can't set up, add money, or open a position, but you can always close, sell, and withdraw. See [access and availability](/getting-started/access/).

## Perps

A perp follows the price of an asset, such as bitcoin or a stock. You don't own the asset. You choose long, if you think the price will rise, or short, if you think it will fall.

Each market's page shows its price chart, from the last few minutes to all time, and its order book: the prices people are offering to sell at above, and to buy at below. You can group the book's prices into wider steps, such as $10 or $100 for bitcoin. Tap a price in the book to start a limit order there: a sell price starts a long, a buy price a short.

- **Your balance.** Your perps account shows its value, what's available to trade, and what you can withdraw. Available to trade is the value less the money your open positions use. While positions are open, Hyperliquid keeps more back from withdrawals than from trading.
- **Amount.** You put in a dollar amount. The order panel shows what's available to trade, and how much of your USDC on Base it can add in the same tap. Max counts both.
- **Leverage.** Leverage starts at the market's maximum, such as 40x for bitcoin. Lower it to take less risk. At 5x, $20 controls a $100 position. If you already hold a position in that market, the order starts at its leverage, and a change applies to it too.
- **Liquidation.** If the price moves against you far enough, Hyperliquid closes your position and you lose the money behind it. The order panel shows an estimated liquidation price before you confirm. With leverage, a small price move can lose everything you put in.
- **Isolated or cross.** Isolated risks only the money behind this position. Cross can use your whole perps balance to keep positions open.
- **Market or limit.** A market order fills now, near the current price. A limit order waits for your price.
- **Take profit and stop loss (TP/SL).** Set a price to close at a profit and one to close at a loss, when you place the order or later from the position's TP/SL button. Each shows roughly what you'd make or lose. A new one replaces the old one.
- **Closing.** Close all of a position or part of it (25%, 50%, or 75%), now at the market price or at a limit price you choose.
- **Your positions.** Each shows its size and value, entry price, the price now, profit or loss in dollars and percent, liquidation price, margin, and its take profit and stop loss.
- **Fees.** Before you confirm, the order shows Hyperliquid's estimated fee for your account. Stock perps cost more to trade than crypto ones.
- **Funding.** Every hour, longs and shorts pay each other a small funding fee. When the rate is positive, longs pay shorts. Each market's page shows it.

If your perps balance is short, Aura adds the difference from your USDC on Base first, then places the order, in one tap. Adding money takes at least $6, because Hyperliquid needs at least $5 to arrive. It usually arrives in a few seconds. You can close the window while it moves; your Transactions show when it lands.

## Predictions

Each market asks a question, such as whether a bill passes by a date. You buy shares in an outcome. Each share pays $1 if that outcome happens, and nothing if it doesn't.

- **Price.** A share's price, in cents, is roughly the market's chance of that outcome. At 64¢, $10 buys about 15.62 shares, which pay $15.62 if it wins: the order shows this as "To win". The price can move before your order fills.
- **Buying.** On a computer, the order panel sits beside the chart. Pick Yes or No, enter an amount or tap +$1, +$20, +$100, or Max, and confirm with your passkey. On a phone, tap Buy Yes or Buy No under the chart.
- **Up or Down.** These short crypto markets ask whether a price ends a window, such as 15 minutes, at or above where it started. The page shows the starting price, the live price from Chainlink, and the time left.
- **Results.** Polymarket decides each result after the market ends, from the source named on the market's page.
- **Selling and collecting.** You can sell shares before the market ends, at the best price buyers offer. Once a market resolves and your outcome won, collect your winnings to your predictions cash.
- **Cash.** Your predictions cash sits in your Polymarket account. Deposit from your USDC on Base, or withdraw it back; Polymarket moves it in a few minutes. If you have no USDC yet, Add money in Aura first.

The first time, setup takes about a minute and two passkey confirmations, once. If you have too little predictions cash for a buy, Aura deposits the difference from your USDC on Base first.

Sports and esports markets aren't offered.

## In Transactions

Money you add to or withdraw from perps or predictions shows in **Transactions** under **Markets**, as Added to perps, Withdrawn from perps, Added to predictions, or Withdrawn from predictions. It's money moving between your own accounts, so the summary in Transactions doesn't count it as money in or out.

## Prices and balances

Prices, balances, and positions come straight from Hyperliquid and Polymarket, with the time they were read. If Aura can't read them, it says so instead of showing an old number.

Related: [risk disclosure](/legal/risk-disclosure/), [fees](/company/fees-and-alignment/).
