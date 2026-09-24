---
title: Account controls
description: Saved addresses, review periods, limits, and account lock.
sidebar:
  order: 2
---

## Higher-risk actions

Aurel holds an in-app action when it requires approval that we cannot yet verify for that exact transaction on the server. Adding a passkey to sign-in alone does not lift that hold.

## Saved addresses

Give trusted destinations clear names and check the full address independently. A newly saved address has a 24-hour cooling period by default.

If Saved Destinations Only is on, adding a new destination needs extra identity verification. Until that review is available, Aurel will not save the new address. You can still rename an address already saved, and its original cooling period stays in place.

For transfers of $1,000 or more, the cooling period blocks immediate use of a newly saved destination. Lower-value new destinations receive a warning unless saved-only mode is enabled. Adding, cooling, and removing a destination creates an audit event.

An address label is for recognition. It is not proof of identity or ownership.

## Review threshold

Actions at or above your chosen threshold, never higher than $10,000, require an extra review step. If Aurel cannot determine a reliable US dollar value, it treats the action as higher risk instead of skipping the check.

The default high-value review starts at $25,000 of rolling 24-hour activity. Once cooling ends, Aurel compares the new preparation with the original instruction. The reviewed release expires after 15 minutes.

## Rolling limit

The default rolling limit is $25,000 over 24 hours for submitted and confirmed estimated USD volume. A limit is not a bank freeze and does not include actions signed outside Aurel.

Price changes and unknown valuations make USD limits approximate. Conservative handling is used when value cannot be established reliably.

## Account lock

The account lock stops Aurel from preparing new outgoing actions. It does not freeze the wallet, reverse submitted transactions, or prevent activity in another app.

Use the lock when account access, a destination, or a recent prompt looks suspicious. Then secure the underlying identity and recovery methods as well. An ordinary session cannot unlock the account or loosen saved-destination, cooling, or limit controls. Contact Support to begin identity review; do not assume a support case immediately restores access.

## Reserve warning

The default $10,000 liquid-reserve preference warns when an action may reduce visible liquid assets below the selected floor. It is guidance, not a custodial reserve or hard transaction block.

## Scope

Controls are evaluated during supported Aurel preparation. Protocol liquidations, provider freezes, gas charges, market movements, exported-wallet activity, and transactions created in another application remain outside their enforcement boundary.

## A practical routine

1. Start with a small amount.
2. Check the network and full address.
3. Read the wallet prompt, not just the Aurel preview.
4. Verify the transaction on the correct block explorer.
5. Treat unexpected prompts as suspicious and cancel them.
