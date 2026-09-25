---
title: Earn and borrow
description: Aave and Sky actions, positions, and risks.
sidebar:
  order: 3
---

Aura reads Aave V3 positions on Base and Sky sUSDS positions on Ethereum. The protocols and chains control balances, rates, debt, and settlement. The development app prepares Aave supply, withdrawal, borrow, and repay calls for eligible accounts. It also prepares Sky deposits and withdrawals: Sky converts Ethereum USDC to sUSDS during deposit and back to USDC during withdrawal. A funded end-to-end signing test is still pending.

## Earn

Aave supply rates change with the market. Sky sUSDS grows through its conversion rate, which can also change. Neither is a bank deposit, insured balance, or guaranteed return. Withdrawals depend on contract operation and available liquidity. Review the asset, amount, approval, contract, network fee, and expected output in your wallet before signing.

USDC on Base must move to Ethereum through a separate reviewed bridge transaction before it can enter Sky. A successful bridge source transaction does not by itself prove arrival on Ethereum.

## Borrow

Aave debt accrues interest. Collateral prices, rates, and health factor can change before and after signing. If a position crosses Aave's liquidation boundary, the protocol can liquidate collateral; Aura cannot pause or reverse it. Repayment may need a token approval, and interest accrued during settlement can leave a small residual debt.

## Rewards and position data

Aura displays claimable Aave rewards reported by the protocol on the supported network. Claiming them in Aura is unavailable. A displayed reward is an observation, not a payment.

Position previews help with a decision but do not guarantee execution. Smart contracts, oracles, governance, stablecoins, liquidity, and networks can fail or change. Keep enough native gas for future transactions. Aura leaves a failed source read unavailable rather than showing zero.
