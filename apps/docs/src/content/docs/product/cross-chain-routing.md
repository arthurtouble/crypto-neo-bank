---
title: Cross-chain routes
description: How Aurel moves USD Coin between your connected accounts without making you manage networks.
---

Aurel Move Money looks across your connected accounts, finds an eligible USD Coin balance, and prepares a route into your Aurel Account. You enter the amount; Aurel handles account and network selection in the background. The same workspace can prepare a withdrawal from your Aurel Account to a supported network and address.

The current routing adapter uses LI.FI. The product is provider-neutral so a contracted Socket route or another approved provider can be added without changing the customer flow.

## What a quote contains

A route quote normally includes the source and destination networks, input and expected output, estimated gas, fees, price impact, timing estimate, approval requirements, and transaction data.

Aurel checks the returned chain, token contracts, wallet addresses, amount, and transaction network against the customer's request and the product allowlist. Quotes expire after one minute. Aurel checks the selected balance again and simulates the approval and route before asking the wallet to present either transaction.

## Safety checks before approval

Before an approval, Aurel evaluates the transfer against the account's transaction controls and step-up rules. An ERC-20 route may then need permission to spend the source token. Aurel prepares an exact-amount approval where supported instead of defaulting to an unlimited allowance.

The approval is a separate onchain transaction. It must be signed, submitted, and confirmed before the route transaction is useful. Aurel will not begin with an expired quote. If the quote expires while approval settles, Aurel keeps the completed approval but requires a new route quote before the transfer can continue.

An exact approval reduces exposure but does not make the route risk-free. The approved contract and the protocols it calls still matter.

## Route lifecycle

1. Open **Move Money** and choose **Add Money** or **Withdraw**.
2. Enter the USD Coin amount and, for a withdrawal, the destination.
3. Aurel checks every connected account on supported networks and requests a live route.
4. Review the amount you send, minimum received, and expected arrival.
5. Aurel rechecks the source balance, applies transaction controls, and simulates the instruction.
6. Sign an exact approval if one is required and wait for its receipt.
7. Sign the route transaction.
8. Track the source transaction and the route reference.
9. Wait for destination delivery or an explicit exception state.

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
- **Account-selection risk:** Aurel selects an eligible source automatically, but you should still review the wallet prompt before signing.

## When to use a direct transfer

If sender and recipient can use the same supported network, a direct transfer is usually simpler and has fewer dependencies. Cross-chain routing is useful when the destination chain is genuinely required, not merely because a route is available.

## Failed or delayed routes

Do not immediately repeat a route because the destination balance has not updated. Repeating it can create a second transfer. Check the activity record, source explorer, route status, destination explorer, and wallet address first. If the route remains unresolved, open a support case with the route reference and transaction hash. Never share a private key or recovery phrase.
