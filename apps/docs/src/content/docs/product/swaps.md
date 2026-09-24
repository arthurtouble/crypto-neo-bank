---
title: Swap
description: Exchange digital assets across supported networks.
---

Swap uses LI.FI's embedded exchange. Search by asset name or contract address, choose what to send and receive, enter an amount, and review the available route before confirming in your wallet. The current app supports Ethereum, Base, Arbitrum, Optimism, and Polygon. An asset appearing in search does not guarantee that a route is available or that its contract is safe.

## Before you exchange

Check the asset contract, network, amount, minimum received, fees, and route. A familiar name or logo can be copied by an unrelated token. Prices and availability can change before you sign. If the quote changes or expires, review the new one.

Some assets need a separate token approval before the exchange transaction. Your wallet will ask you to confirm each transaction. An approval can remain onchain if you do not complete the exchange; you can revoke it later. Aurel cannot sign for you.

## Track an exchange

Use **Activities** inside Swap to follow a submitted LI.FI route, including a cross-network route. A source-network transaction is not proof that the destination asset has arrived. If delivery is delayed, check the route there before trying again.

This development integration uses LI.FI's wallet and execution flow directly. Aurel's separate transaction-control and Activity system does not yet govern or record these widget exchanges. Balances and settlement remain onchain, not in Aurel's database.
