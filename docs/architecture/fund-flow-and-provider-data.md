---
title: Fund flow and provider data map
description: Fund movements, authoritative sources, and provider data responsibilities.
---

## Self-controlled onchain transfer

All onchain movements follow [money actions](money-actions.md).

## Send

`Customer request → Aurel controls and exact calls → customer signs a Privy authorization (Privy asks for their passkey) → Aurel relays through Privy (gas sponsored) → Base → Aurel verifies identity, finality, and Transfer effect`

- Aurel prepares; it does not possess a customer signing key.
- Base is authoritative for balance and receipt.
- D1 retains the action, its calls and effects, the transaction hash, and verification events.

## Swaps and cross-chain moves

`Customer request → LI.FI quote held server-side → Aurel validation (Diamond target and spender, price impact, slippage) → approval + route in one operation → source debit verified → LI.FI status → destination receipt with minimum output`

- Source confirmation is not destination delivery.
- LI.FI supplies route state; the chains remain authoritative for their transactions.
- The action stays `settling` until delivery is verified.

## Earn (Aave V3 and Morpho vaults on Base)

`Customer request → Aurel controls → on-chain vault re-check (Morpho) → exact approval + supply/deposit, or withdraw/redeem, in one operation → protocol contracts → Aave Supply/Withdraw or the vault's Deposit/Withdraw events verified`

- The protocols determine rates and liquidity. Morpho vault curators (Steakhouse Financial, Gauntlet) choose which markets each vault lends to. Displayed rates come from Aave's data service and Morpho's public API and are unavailable when the read fails.
- A vault withdrawal depends on its markets' liquidity; if they can't release enough, the transaction reverts and nothing moves.
- Aurel cannot guarantee liquidity or returns.

## Future regulated fiat conversion

`Customer onboarding (Bridge KYC link) → Bridge KYC decision → USD virtual account depositing to the Aura account, or payout to a Bridge Base deposit address funded by a transfer action → Bridge record → signed Bridge event at /api/webhooks/bridge → Aurel projection`

- The provider's contract must define account holder, safeguarding, conversion counterparty, settlement, reversals, freezes and complaints.
- Aurel should retain status and opaque references, not original identity documents.
- No regulated flow is active until signed contracts and the country matrix approve it.

## Data minimization

| System | Aurel stores | Aurel does not store |
|---|---|---|
| Privy | Verified subject, embedded wallet address, Privy relay reference for each action | Private key, recovery secret, one-time code |
| Chain/protocol | Address, chain, asset, transaction hash, source block, observation time | A proprietary balance ledger |
| LI.FI | Server-held quote, route status, and transaction evidence | A claim that source confirmation equals destination delivery |
| Future regulated provider | Customer/resource reference, eligibility/status, reconciliation evidence | Original KYC documents unless a contract and legal need explicitly require them |
