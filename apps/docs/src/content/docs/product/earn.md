---
title: Earn
description: Aave and Sky actions, positions, and risks.
sidebar:
  order: 3
---

Aura reads Aave V3 positions on Base and Sky sUSDS positions on Ethereum. The protocols and chains control balances, rates, debt, and settlement. The development app prepares Aave supply and withdrawal on Base, and Sky deposits and withdrawals on Ethereum. Sky converts Ethereum USDC to sUSDS on deposit and back to USDC on withdrawal. No funded transaction has been signed yet.

## Earn

Aave supply rates change with the market. Sky sUSDS grows through its conversion rate, which can also change. Neither is a bank deposit, insured balance, or guaranteed return. Withdrawals depend on contract operation and available liquidity. Any approval and the deposit are signed together, as one operation. Review the asset, amount, and network in your wallet before signing. Aura marks a deposit or withdrawal complete only after it sees the protocol's own record of it onchain.

USDC on Base must first move to Ethereum with a separate cross-chain move before it can enter Sky. Wait until that move shows complete.

## Rewards and position data

Aura displays claimable Aave rewards reported by the protocol on the supported network. Claiming them in Aura is unavailable. A displayed reward is an observation, not a payment.

Position previews help with a decision but do not guarantee execution. Smart contracts, oracles, governance, stablecoins, liquidity, and networks can fail or change. Aura leaves a failed source read unavailable rather than showing zero.
