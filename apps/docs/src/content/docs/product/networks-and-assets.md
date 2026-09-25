---
title: Networks and assets
description: The networks and assets Aura supports, and how to avoid sending to the wrong place.
---

Aura always shows the network when you receive, send, swap, or earn.

The same address can hold different balances on different networks. Check the network in Deposit before anyone sends you money. Use Swap to move assets between networks.

## Supported networks

| Network | Chain ID | Fee asset | What you can do |
| --- | ---: | --- | --- |
| Base | 8453 | ETH | Your Aura account: send, swap, and earn with Aave |
| Ethereum | 1 | ETH | Swap, move between networks, and Sky savings |
| Arbitrum | 42161 | ETH | Swap and move between networks |
| Optimism | 10 | ETH | Swap and move between networks |
| Polygon | 137 | POL | Swap and move between networks |

"Supported" means Aura knows the exact network, asset, and action. It doesn't mean a route, data service, market, or protocol will always be available.

## Identifying assets

A token's symbol isn't a safe way to identify it. Unrelated tokens can share a name and symbol. Aura identifies each asset by its network and contract address together.

Swap lists assets from LI.FI and marks the ones Aura has reviewed as verified. Unverified assets get a tighter price-impact limit.

On Base, your main balance view shows:

- ETH;
- USDC, at Circle's official Base contract;
- WETH, at Base's standard contract.

A token can arrive at your address without showing in Aura. It hasn't disappeared. Aura just doesn't recognize or price it yet. Check unknown tokens on a block explorer, and don't interact with tokens you didn't expect.

## USDC comes in different versions

USDC exists in different forms on different networks. Aura marks native USDC on each supported network as verified. A bridged token labeled "USDC" can behave differently, and may be harder to sell or redeem.

Always check the network and contract, not just the symbol.

## Network fees

Aura plans to cover network fees on Base for the actions it prepares. That isn't set up yet. Until it is, you'll need a little ETH on Base. You'll always need the network's fee asset on other networks, and for anything you do outside Aura.

Fees can change between preparing and sending a transaction. Signing doesn't guarantee a transaction goes through. A dropped or replaced transaction may need looking into.

## Before you send to your Aura account

Check that:

1. the address is right;
2. the network is right;
3. Aura supports the asset on that network;
4. the app or exchange you're sending from supports that exact network.

Sending an unsupported token, or using the wrong network, can make recovery hard or impossible. Aura support can't reverse a blockchain transfer.

## Adding support for an asset

Adding an asset is more than adding an icon. We review its contract, issuer or protocol, liquidity, price source, how it transfers, and what you need to know about it. Tokenized stocks and other securities need a separate review. See [tokenized markets](/product/tokenized-markets/).
