---
title: Send and route
description: Direct transfers, cross-chain routes, checks, and confirmation.
sidebar:
  order: 2
---

## Direct transfers

Aurel checks the supported network, asset, destination, amount, account settings, and review rules before asking your wallet to sign. A Base transfer also runs a gas estimate and execution check where the network supports it.

Saving an address does not prove that you control it. Check the full address independently.

For a supported direct transfer, Aurel evaluates the account lock, network, asset, destination rules, cooling status, rolling amount, review threshold, step-up requirement, and required warnings. Passing those checks means Aurel may prepare the action. It does not certify the recipient or guarantee settlement.

### Before sending

- Confirm the chain with the recipient.
- Compare the full address through an independent channel.
- Review the token contract, not only its symbol.
- Keep enough native gas for the transfer.
- Use a small test when the destination is new.
- Read the wallet prompt before signing.

A transaction sent to a valid but unintended address is usually irreversible.

## Exchange

Aurel searches connected accounts for enough USD Coin and requests a route into your Aurel Account. You do not need to choose a network. Aurel checks that the returned source, destination, assets, and target match the prepared instruction. If a token approval is needed, Aurel requests the exact amount instead of an unlimited approval by default.

Routes add dependencies that direct transfers do not have, including bridge contracts, relayers, liquidity, finality, and the destination chain.

The approval and route can be separate transactions. Aurel waits for the exact approval receipt before presenting the route transaction. If the quote is no longer current, a new route should be prepared.

See [Cross-chain routes](/product/cross-chain-routing/) for the complete lifecycle and delayed-route guidance.

## What confirmation means

- **Reviewed** means Aurel’s checks passed. It does not mean the transaction was signed.
- **Submitted** means a transaction hash exists.
- **Confirmed** means Aurel observed a successful source-chain receipt.
- Destination delivery may still need separate confirmation for a cross-chain route.

Quotes, gas, price impact, and timing can change before you sign.

## Limits and review

The default rolling transaction limit is $25,000 over 24 hours for Aurel-prepared actions. A new saved destination has a 24-hour cooling period for transfers of $1,000 or more. Higher-value actions enter a review path and must be resubmitted with the same material instruction within the release window.

These controls only cover actions prepared through Aurel. They do not freeze the underlying wallet.

## If a transfer looks stuck

Check the transaction hash on the correct source-chain explorer. A pending, replaced, reverted, and confirmed transaction need different responses. Do not send the same payment again until you know whether the first instruction settled.

For a route, source confirmation is only one step. Use the route reference and destination explorer as well. Support can investigate evidence but cannot reverse a confirmed chain transaction.
