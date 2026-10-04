---
title: Networks and assets
description: The networks (Base, Ethereum, Arbitrum, Optimism, Polygon) and assets (ETH, USDC, EURC, cbBTC, stocks, gold) Aura supports, and how to avoid sending to the wrong place.
---

Aura always shows the network when you receive, send, swap, or earn. The same address can hold different balances on different networks. Your address and QR code in Add money are for Base only.

- To add money from another network, use **Deposit > From a wallet**. Aura moves it to the same asset on Base.
- To send to someone on another network, choose the network in **Send**.
- To move assets between networks from your Aura account, use Swap.

## Supported networks

| Network | Chain ID | Fee asset | What you can do |
| --- | ---: | --- | --- |
| Base | 8453 | ETH | Your Aura account: add money, send, swap, and earn with Aave and Morpho |
| Ethereum | 1 | ETH | Add ETH or USDC from a wallet, swap, and Tether Gold, which your account holds here |
| Arbitrum | 42161 | ETH | Add ETH or USDC from a wallet, and swap |
| Optimism | 10 | ETH | Add ETH or USDC from a wallet, and swap |
| Polygon | 137 | POL | Add USDC from a wallet, and swap |

"Supported" means Aura knows the exact network, asset, and action. It doesn't mean every exchange, data service, market, or partner will always be available.

## Supported assets

Your balances show in these Overview groups:

| Asset | Network | Group |
| --- | --- | --- |
| ETH | Base | Crypto |
| USDC, at Circle's official contract | Base | Cash |
| EURC, Circle's euro stablecoin | Base | Cash |
| WETH, at Base's standard contract | Base | Crypto |
| cbBTC, Coinbase's wrapped bitcoin | Base | Crypto |
| Ten stocks, as tokens issued by Coinbase ([list](/product/tokenized-stocks-and-gold/)) | Base | Stocks |
| Tether Gold (XAUt), only issued on Ethereum | Ethereum | Metals |
| Aave USDC and WETH you've supplied, and Morpho USDC vault shares | Base | Earn |

You can send and swap every asset in the table except Earn positions. From a connected wallet, you can add ETH, USDC, or EURC on Base, or ETH or USDC from another network (only USDC from Polygon).

Unrelated tokens can share a name and symbol, so Aura identifies each asset by its network and contract address together. Add money, Send, and Swap only offer these assets, and Aura's servers refuse anything else.

A token can arrive at your address without showing in Aura. It hasn't disappeared; Aura just doesn't recognize or price it. Check unknown tokens on a block explorer, and don't interact with tokens you didn't expect.

## USDC comes in different versions

Aura supports native USDC on each supported network. Another token labeled "USDC", such as one a third party moved from another network (often called bridged USDC), can behave differently, and may be harder to sell or redeem. Check the network and contract, not just the symbol.

## Network fees

Aura pays the network fee for actions your Aura account signs. When you add money from your own wallet, that wallet pays its network's fee. For anything you do outside Aura, you'll need the network's fee asset.

Fees can change between preparing and sending a transaction. Signing doesn't guarantee a transaction goes through. A dropped or replaced transaction may need looking into.

## Before you send to your Aura account

Check that:

1. the address is right;
2. the network is right;
3. Aura supports the asset on that network;
4. the app or exchange you're sending from supports that exact network.

Sending an unsupported token, or using the wrong network, can make recovery hard or impossible. Aura support can't reverse a blockchain transfer.

## Adding support for an asset

Before we add an asset, we review its contract, its issuer, how easily it can be bought and sold, its price source, and how it transfers.

We can pause an asset at any time, for example if a stablecoin loses its peg. A paused asset stays in your balance. Until it's resumed, you can't send, swap, or buy it, or add it from another network.
