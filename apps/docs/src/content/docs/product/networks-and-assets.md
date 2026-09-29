---
title: Networks and assets
description: The networks and assets Aura supports, and how to avoid sending to the wrong place.
---

Aura always shows the network when you receive, send, swap, or earn.

The same address can hold different balances on different networks. Check the network in Deposit before anyone sends you money. Your address and QR code in Deposit are for Base only.

To add money from another network, use **Deposit > From a wallet**. Aura moves it to the same asset on Base. To send to someone on another network, choose the network in **Send**. Use Swap to move assets between networks from your Aura account.

## Supported networks

| Network | Chain ID | Fee asset | What you can do |
| --- | ---: | --- | --- |
| Base | 8453 | ETH | Your Aura account: deposit, send, swap, and earn with Aave and Morpho |
| Ethereum | 1 | ETH | Deposit ETH or USDC, swap, and Tether Gold, which your account holds here |
| Arbitrum | 42161 | ETH | Deposit ETH or USDC, and swap |
| Optimism | 10 | ETH | Deposit ETH or USDC, and swap |
| Polygon | 137 | POL | Deposit USDC, and swap |

"Supported" means Aura knows the exact network, asset, and action. It doesn't mean a route, data service, market, or protocol will always be available.

## Identifying assets

A token's symbol isn't a safe way to identify it. Unrelated tokens can share a name and symbol. Aura identifies each asset by its network and contract address together.

Aura supports a reviewed list of assets. Deposit, Send, and Swap only offer assets on that list, and Aura's servers refuse anything else.

On Base, your main balance view shows:

- ETH;
- USDC, at Circle's official Base contract;
- EURC, Circle's euro stablecoin;
- WETH, at Base's standard contract;
- cbBTC, Coinbase's wrapped bitcoin;
- ten tokenized stocks issued by Coinbase. See [tokenized stocks and gold](/product/tokenized-markets/).

It also shows Tether Gold (XAUt), which is only issued on Ethereum, so your account holds it there.

A token can arrive at your address without showing in Aura. It hasn't disappeared. Aura just doesn't recognize or price it yet. Check unknown tokens on a block explorer, and don't interact with tokens you didn't expect.

## USDC comes in different versions

USDC exists in different forms on different networks. Aura supports native USDC on each supported network. A bridged token labeled "USDC" can behave differently, and may be harder to sell or redeem.

Always check the network and contract, not just the symbol.

## Network fees

Aura pays the network fee for actions your Aura account signs. When you add money from your own wallet, that wallet pays its network's fee. You'll also need the network's fee asset for anything you do outside Aura.

Fees can change between preparing and sending a transaction. Signing doesn't guarantee a transaction goes through. A dropped or replaced transaction may need looking into.

## Before you send to your Aura account

Check that:

1. the address is right;
2. the network is right;
3. Aura supports the asset on that network;
4. the app or exchange you're sending from supports that exact network.

Sending an unsupported token, or using the wrong network, can make recovery hard or impossible. Aura support can't reverse a blockchain transfer.

## Adding support for an asset

Adding an asset is more than adding an icon. We review its contract, issuer or protocol, liquidity, price source, and how it transfers before we add it. We can also pause an asset at any time, for example if a stablecoin loses its peg. A paused asset stays in your balance, but you can't send, swap, or buy it, or deposit it from another network, until it's resumed.
