---
title: Send and route
description: Direct transfers, cross-chain routes, checks, and confirmation.
sidebar:
  order: 2
---

## Direct transfers

Aura checks the supported network, asset, destination, amount, account settings, and review rules before asking your wallet to sign. A supported Base transfer is prepared as an exact call and checked again just before your wallet opens. If the transfer or your account controls changed, you need a new review. Higher-value actions that need step-up remain paused until Aura can verify the step-up server-side.

Saving an address does not prove that you control it. Check the full address independently.

For a supported direct transfer, Aura evaluates the account lock, network, asset, destination rules, cooling status, rolling amount, review threshold, step-up requirement, and required warnings. Passing those checks means Aura may prepare the action. It does not certify the recipient or guarantee settlement.

### Before sending

- Confirm the chain with the recipient.
- Compare the full address through an independent channel.
- Review the token contract, not only its symbol.
- Keep enough native gas for the transfer.
- Use a small test when the destination is new.
- Read the wallet prompt before signing.

A transaction sent to a valid but unintended address is usually irreversible.

## Add Money and Withdraw

Move Money can search connected accounts and show a potential USD Coin route. Cross-network execution is currently paused. A route preview is not a prepared transfer, and it will not ask for a wallet signature while the exact approval and route plan cannot pass Aura's checks.

Routes add dependencies that direct transfers do not have, including bridge contracts, relayers, liquidity, finality, and the destination chain.

When execution becomes available, approvals and routes will be separate transactions. Each step must be freshly reviewed, simulated, and independently confirmed in order. An expired quote will need a new review.

See [Cross-chain routes](/product/cross-chain-routing/) for the complete lifecycle and delayed-route guidance.

## What confirmation means

- **Reviewed** means Aura’s checks passed. It does not mean the transaction was signed.
- **Submitted** means a transaction hash exists.
- **Confirmed** for a newly prepared transfer means Aura matched the transaction and expected effect, checked the receipt against the canonical block, and waited for its finality threshold. Older receipt-only records are marked unverified.
- Destination delivery may still need separate confirmation for a cross-chain route.

Quotes, gas, price impact, and timing can change before you sign.

## Limits and review

The default rolling transaction limit is $25,000 over 24 hours for Aura-prepared actions. A new saved destination has a 24-hour cooling period for transfers of $1,000 or more. Higher-value actions enter a review path and must be resubmitted with the same material instruction within the release window.

These controls only cover actions prepared through Aura. They do not freeze the underlying wallet.

## If a transfer looks stuck

Check the transaction hash on the correct source-chain explorer. A pending, replaced, reverted, and confirmed transaction need different responses. Do not send the same payment again until you know whether the first instruction settled.

For a route, source confirmation is only one step. Use the route reference and destination explorer as well. Support can investigate evidence but cannot reverse a confirmed chain transaction.
