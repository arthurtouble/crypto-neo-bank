---
title: Fund flow and provider data map
description: Fund movements, authoritative sources, and provider data responsibilities.
---

## Self-controlled onchain transfer

`Customer request → Aurel policy and simulation → Privy wallet confirmation → Base transaction → Base receipt → Aurel evidence and display`

- Aurel prepares; it does not possess a customer signing key.
- Base is authoritative for balance and receipt.
- D1 retains the instruction, policy result, transaction hash and checks.

## Cross-chain USDC

`Customer request → LI.FI quote → Aurel route validation → exact token approval → source receipt → route transaction → bridge/exchange/relayer → destination chain → destination evidence`

- Source confirmation is not destination delivery.
- LI.FI and route components supply route state; the chains remain authoritative for their transactions.
- Aurel retains route references and raises an exception when state remains ambiguous.

## Aave V3

`Customer request → Aurel policy → Aave preview/plan → Privy confirmation → Aave contracts on Base → protocol position read`

- Aave contracts determine collateral, debt, rates and liquidation.
- Aurel cannot pause liquidation or guarantee liquidity.

## Future regulated fiat conversion

`Customer onboarding → regulated-provider KYC decision → provider account/rail instruction → provider fiat record → provider conversion → provider or customer wallet delivery → signed provider event → Aurel reconciliation`

- The provider's contract must define account holder, safeguarding, conversion counterparty, settlement, reversals, freezes and complaints.
- Aurel should retain status and opaque references, not original identity documents.
- No regulated flow is active until signed contracts and the country matrix approve it.

## Data minimization

| System | Aurel stores | Aurel does not store |
|---|---|---|
| Privy | Verified subject, public wallet reference | Private key, recovery secret, one-time code |
| Chain/protocol | Address, chain, asset, transaction hash, source block, observation time | A proprietary balance ledger |
| LI.FI | Quote/route reference and transaction evidence | A claim that source confirmation equals destination delivery |
| Future regulated provider | Customer/resource reference, eligibility/status, reconciliation evidence | Original KYC documents unless a contract and legal need explicitly require them |
