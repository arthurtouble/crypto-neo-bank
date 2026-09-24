---
title: Cross-chain routes
description: How to read route previews and what must happen before cross-chain transfers resume.
---

Aura Move Money can look across connected accounts for USD Coin and show possible routes. Its cross-network execution remains paused. The separate Swap screen can exchange curated assets across supported networks through LI.FI and the connected wallet. Keep Swap open to follow progress. These transactions do not pass through Aura's Move Money controls or Activity ledger.

The route-preview and governed-signing system described below is Aura's separate, currently disabled API flow. It does not describe Swap's LI.FI SDK execution process.

## What a quote contains

A route quote may include the source and destination networks, input and expected output, estimated gas, fees, price impact, timing estimate, and approval requirements. These are estimates, not a completed transfer.

Aura checks route fields against the customer's request and product rules. Quotes expire quickly. Swap's reviewed USDC route holds the exact approval and transaction calls server-side and prepares one step at a time. Move Money route previews do not yet prepare cross-network signing requests.

## Safety checks before approval

Before any future approval, Aura must evaluate the transfer against the account's transaction controls and step-up rules. An ERC-20 route may then need permission to spend the source token. Any approval should be limited to the reviewed amount and spender where supported.

The approval is a separate onchain transaction. It must be independently confirmed before the route transaction is useful. If a quote expires while approval settles, the customer needs a new route review. An approval can remain outstanding even when a later route is not sent.

An exact approval reduces exposure but does not make the route risk-free. The approved contract and the protocols it calls still matter.

## Required route lifecycle before activation

1. Aura checks the owned source wallet, amount, destination, route, and current limits.
2. Any required step-up is verified, and the exact approval is prepared and simulated.
3. The customer signs the approval; Aura verifies its effect and finality.
4. Aura obtains a fresh route, prepares and simulates the exact transaction, then asks for a separate signature.
5. Aura verifies the source transaction and tracks destination delivery independently.

This sequence is implemented for Swap's narrow USDC route, but live use still needs a small-funds rehearsal and operator activation. It is not a claim that every cross-network transfer is available.

## Source confirmation is not destination delivery

A successful source-chain receipt proves that the source transaction executed. It does not prove that the expected asset arrived on the destination chain.

Bridges and relayers may need additional confirmations. Destination execution can be delayed or fail. Aura retains the route reference and source transaction hash so support can investigate with the routing provider and relevant chains.

## Main risks

- **Quote expiry:** market conditions or route availability can change before signing.
- **Price impact:** the received amount can differ within the disclosed tolerance.
- **Contract risk:** the route may touch several smart contracts.
- **Bridge risk:** funds depend on bridge design, validators, messaging, and liquidity.
- **Relayer risk:** delivery can be delayed even after source confirmation.
- **Finality risk:** a chain reorganization can affect a recent transaction.
- **Account-selection risk:** A route preview can identify a source account, but it must be checked again before signing becomes available.

## When to use a direct transfer

If sender and recipient can use the same supported network, a direct transfer is usually simpler and has fewer dependencies. Cross-chain routing is useful when the destination chain is genuinely required, not merely because a route is available.

## Failed or delayed routes

Do not immediately repeat a route because the destination balance has not updated. Repeating it can create a second transfer. Check the activity record, source explorer, route status, destination explorer, and wallet address first. If the route remains unresolved, open a support case with the route reference and transaction hash. Never share a private key or recovery phrase.
