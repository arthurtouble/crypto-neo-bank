---
title: Account controls
description: Feature availability, saved recipients, daily limit, and account lock.
sidebar:
  order: 2
---

## Feature availability

Aura can switch each financial feature on or off for everyone: direct transfers, swaps, cross-network moves, Aave and Sky actions, tokenized markets, bank accounts, and cards. When a feature is off, Aura will not prepare new actions for it, Your wallet still works in other apps.

## Wallet provider rules

If your wallet provider enforces its own rules, such as a spending limit or an address allowlist, Settings shows them next to Aura's controls. The provider applies them when it signs; change them with the provider.

## Your settings

You set these in Settings. Changes apply right away and are recorded.

| Control | Default | What it does |
| --- | --- | --- |
| Emergency lock | Off | Blocks every money movement through Aura |
| Daily limit | Off | Caps the US dollar value you send to other people in any 24 hours |
| Saved recipients only | Off | Only lets you send to saved recipients |
| Wait before new recipients | 4 hours | With saved recipients only on, a newly saved recipient can't receive until the wait ends |

## Saved recipients

Give trusted recipients clear names and check the full address independently. A label is for recognition. It is not proof of identity or ownership. Adding and removing a recipient creates an audit event.

## Daily limit

The daily limit counts sends and swaps that pay another address. Swaps and Earn moves within your own account don't count. If Aura cannot value an amount while a limit is set, it blocks the action instead of skipping the check. Price changes make USD limits approximate.

## Account lock

The lock stops Aura from preparing any money movement. It does not freeze the wallet, reverse submitted transactions, or prevent activity in another app.

Use the lock when account access, a recipient, or a recent prompt looks suspicious. Then secure your sign-in and recovery methods as well.

## Scope

Controls apply when Aura prepares a money movement. Provider freezes, gas charges, market movements, an exported key, and transactions created in another application remain outside their enforcement boundary.

## A practical routine

1. Start with a small amount.
2. Check the network and full address.
3. Read the wallet prompt, not just the Aura summary.
4. Verify the transaction on the correct block explorer.
5. Treat unexpected prompts as suspicious and cancel them.
