---
title: Send and route
description: Direct transfers, cross-chain routes, checks, and confirmation.
sidebar:
  order: 2
---

## Direct transfers

Aurel checks the supported network, asset, destination, amount, account settings, and review rules before asking your wallet to sign. A Base transfer also runs a gas estimate and execution check where the network supports it.

Saving an address does not prove that you control it. Check the full address independently.

## Cross-chain USDC

LI.FI supplies route quotes. Aurel checks that the returned networks, assets, and target match your request. If a token approval is needed, Aurel requests the exact amount instead of an unlimited approval by default.

Routes add dependencies that direct transfers do not have, including bridge contracts, relayers, liquidity, finality, and the destination chain.

## What confirmation means

- **Reviewed** means Aurel’s checks passed. It does not mean the transaction was signed.
- **Submitted** means a transaction hash exists.
- **Confirmed** means Aurel observed a successful source-chain receipt.
- Destination delivery may still need separate confirmation for a cross-chain route.

Quotes, gas, price impact, and timing can change before you sign.
