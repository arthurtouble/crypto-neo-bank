---
title: Cross-chain routes
description: How Aurel discovers, checks, signs, and follows a USDC route across networks.
---

Aurel uses LI.FI to discover routes for native USDC across supported EVM networks. A route can combine bridges, exchanges, relayers, and destination contracts. It is more complex than a direct transfer on one chain.

## What a quote contains

A route quote normally includes the source and destination networks, input and expected output, estimated gas, fees, price impact, timing estimate, approval requirements, and transaction data.

Aurel checks the returned chain, token contracts, wallet addresses, amount, approval target, and transaction target against the customer's request and the product allowlist. The wallet still presents the final transactions for customer confirmation.

## Approval first

An ERC-20 route may need permission to spend the source token. Aurel prepares an exact-amount approval where supported instead of defaulting to an unlimited allowance.

The approval is a separate onchain transaction. It must be signed, submitted, and confirmed before the route transaction is useful. If the quote expires while the approval is settling, Aurel should request a fresh route instead of reusing stale transaction data.

An exact approval reduces exposure but does not make the route risk-free. The approved contract and the protocols it calls still matter.

## Route lifecycle

1. Choose the source network, destination network, and amount.
2. Request a live route.
3. Review expected output, costs, route steps, and warnings.
4. Sign an exact approval if one is required.
5. Wait for the approval receipt and refresh the route if necessary.
6. Sign the route transaction.
7. Track the source transaction and the route reference.
8. Wait for destination delivery or an explicit exception state.

## Source confirmation is not destination delivery

A successful source-chain receipt proves that the source transaction executed. It does not prove that the expected asset arrived on the destination chain.

Bridges and relayers may need additional confirmations. Destination execution can be delayed or fail. Aurel retains the route reference and source transaction hash so support can investigate with the routing provider and relevant chains.

## Main risks

- **Quote expiry:** market conditions or route availability can change before signing.
- **Price impact:** the received amount can differ within the disclosed tolerance.
- **Contract risk:** the route may touch several smart contracts.
- **Bridge risk:** funds depend on bridge design, validators, messaging, and liquidity.
- **Relayer risk:** delivery can be delayed even after source confirmation.
- **Finality risk:** a chain reorganization can affect a recent transaction.
- **Wrong-network risk:** the destination asset arrives on the selected destination chain, not automatically where it is most useful.

## When to use a direct transfer

If sender and recipient can use the same supported network, a direct transfer is usually simpler and has fewer dependencies. Cross-chain routing is useful when the destination chain is genuinely required, not merely because a route is available.

## Failed or delayed routes

Do not immediately repeat a route because the destination balance has not updated. Repeating it can create a second transfer. Check the activity record, source explorer, route status, destination explorer, and wallet address first. If the route remains unresolved, open a support case with the route reference and transaction hash. Never share a private key or recovery phrase.

