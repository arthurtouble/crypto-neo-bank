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

Aurel supports approval-required transfer plans. Choose a saved wallet recipient, amount, asset, first review time, and one-time, weekly, or monthly frequency. The time follows your selected local timezone; daylight-saving changes keep the same local hour where possible.

When a review is due, it appears in **Due for review**. Opening it prefills the recipient and asset, but leaves the amount blank. You enter the amount and complete a fresh security review, simulation, and wallet confirmation before anything moves. A due reminder is not a payment instruction or proof of settlement.

Provider-managed bank schedules will only become available after the banking provider is active. Their status will come from that provider.

## Pause or resume

You can pause, resume, or cancel an Aurel transfer plan from Move Money. Pausing or cancelling dismisses unreviewed reminders; resuming schedules the next future review rather than replaying missed dates. None of these actions reverses a transfer already signed or submitted.

## Safety rules

- Saving a recipient does not authorize a payment.
- Opening a prefilled Send flow does not bypass transaction review or wallet confirmation.
- A cooling recipient cannot be used for a scheduled plan.
- Current authentication and transaction controls are evaluated at execution time.
- Provider and blockchain records remain the final source for settlement.
