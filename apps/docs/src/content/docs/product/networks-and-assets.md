---
title: Networks and assets
description: The chains, tokens, contract addresses, and availability rules Aura supports.
---

Aura shows the network when you receive, send, swap, or use a vault.

The same wallet address can hold different balances on different networks. Check the network in Receive before sending. Use Swap to review a supported bridge route when funds need to move between networks.

## Current network scope

| Network | Chain ID | Gas asset | Current scope |
| --- | ---: | --- | --- |
| Base | 8453 | ETH | Aura Account, direct sends, Aave V3, and routed native USDC |
| Ethereum | 1 | ETH | Routed native USDC and Sky sUSDS |
| Arbitrum | 42161 | ETH | Routed native USDC |
| Optimism | 10 | ETH | Routed native USDC |
| Polygon | 137 | POL | Routed native USDC |

“Supported” means Aura knows the exact chain, asset, and permitted action. It does not guarantee that a route, RPC endpoint, market, or protocol is continuously available.

## Asset identity

A token symbol is not a safe identifier. Many unrelated contracts can use the same name and symbol. Aura identifies ERC-20 assets using the chain ID and allowlisted contract address together.

On Base, the primary asset view reads:

- native ETH;
- native USDC at the allowlisted Base contract;
- WETH at the allowlisted Base contract.

An asset sent to a wallet may exist onchain without appearing in Aura. That does not mean it has disappeared. It means the product does not yet recognize or price it. Customers should verify unknown assets with a block explorer and avoid interacting with unsolicited tokens.

## Native USDC and bridged variants

USDC exists in different forms across networks. Aura's routed-transfer flow uses specifically allowlisted native USDC contracts. A bridged token that displays “USDC” may have different liquidity, issuer treatment, or redemption behavior and may not be accepted by the route.

Always verify the network and contract, not just the symbol.

## Gas

Onchain actions need the native gas asset of the source network. Holding USDC alone may not be enough to transfer or approve it.

Gas estimates can change between preparation and inclusion. A successful wallet signature does not guarantee that a transaction will be included, and a dropped or replaced transaction can require investigation.

## Unsupported deposits

Before sending an asset to an Aura wallet, confirm:

1. the destination address is correct;
2. the destination network is correct;
3. Aura supports the asset on that network;
4. enough gas will remain for the next intended action;
5. any sending platform supports withdrawals to that exact network.

Sending an unsupported token or using an incompatible network can make recovery difficult or impossible. Aura support cannot reverse a public-chain transfer.

## Adding support

Adding an asset is more than adding an icon. Aura reviews the contract, decimals, issuer or protocol, liquidity, price source, transfer behavior, network dependencies, and customer disclosures. Tokenized securities require a separate eligibility and distribution review described in [Tokenized markets](/product/tokenized-markets/).
