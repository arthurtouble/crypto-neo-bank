---
title: Recipients and scheduled transfers
description: Save destinations safely and plan future transfers without giving up approval.
---

## Recipients

Recipients keep frequently used destinations in one place.

Wallet recipients follow the security delay configured for your account. A newly saved address is marked **Cooling** until that delay ends. Once available, the recipient offers separate **Send** and **Schedule** actions. Send opens a prefilled review flow; it does not submit a transaction.

Recent addresses may appear before you save them. Recent does not mean verified. Choosing **Save** starts the normal cooling period; it does not promote the address directly to verified status.

Bank recipients will appear after bank transfers are enabled and the banking provider has created or verified them. Aurel does not invent bank-recipient status or store bank credentials as its own record.

## Scheduled transfers

Aurel currently supports approval-required transfer plans. You can choose a saved recipient, an amount, an asset, a first date, and a one-time, weekly, or monthly frequency.

A plan does not move money automatically. You still review and approve each transfer. This keeps wallet control with you and ensures current security checks run before value moves.

Provider-managed bank schedules will only become available after the banking provider is active. Their status will come from that provider.

## Pause or resume

You can pause or resume an Aurel transfer plan from Move Money. Pausing the plan does not reverse a transfer that was already signed or submitted.

## Safety rules

- Saving a recipient does not authorize a payment.
- Opening a prefilled Send flow does not bypass transaction review or wallet confirmation.
- A cooling recipient cannot be used for a scheduled plan.
- Current authentication and transaction controls are evaluated at execution time.
- Provider and blockchain records remain the final source for settlement.
