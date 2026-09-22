---
title: Direct deposit and Payday Plans
description: Preparing payroll deposits and planning how incoming pay should be organized.
---

Direct Deposit and Payday Plans are separate features. Direct Deposit provides account details that an employer or payroll provider can use. A Payday Plan describes how a customer would like recognized income organized after it arrives.

## Direct Deposit

Direct Deposit becomes available only after the banking provider has approved the customer and issued an active account. Until then, Aurel shows **Setup Required** and does not display placeholder routing or account numbers.

When an account is active, the customer can share the provider-issued details with an employer or payroll portal. Payroll timing, limits, supported payment types, returns, and any early-pay feature are controlled by the provider. Aurel does not promise that pay will arrive early.

## Payday Plans

A Payday Plan can divide expected income across three intentions:

- **Available to Spend** — value intended to remain readily available.
- **Goals** — value intended for a linked savings goal or eligible subaccount.
- **Earn** — value intended for an eligible yield market after required risk review.

The percentages must be whole numbers from 0 to 100 and must total exactly 100%. Customers can prepare a plan for the next paycheck or every paycheck.

## Drafts do not move money

A plan saved before provider activation remains a draft. It does not detect income, reserve funds, create transfers, approve a protocol, or authorize future transactions.

Activation requires all of the following:

1. An active provider-issued bank account.
2. Provider-observed incoming-income eligibility.
3. Available destination accounts or eligible onchain markets.
4. Current disclosures, quotes, and eligibility checks where required.
5. A separate customer-approved provider mandate or wallet authorization.

Aurel will not convert a planning preference into an active mandate silently.

## Editing and pausing

Saving a revised plan archives the previous draft and creates a new one. A paused draft remains visible but is not eligible for activation. The activity and audit records identify customer changes without presenting the draft as a settled financial event.

## Sources of truth

The banking provider is authoritative for account details, incoming payroll, recognition of an eligible income payment, and any provider-executed allocation. A supported blockchain or protocol is authoritative for onchain settlement. Aurel’s database contains only the planning preference, workflow state, and audit evidence.
