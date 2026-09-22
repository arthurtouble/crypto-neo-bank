---
title: Transaction verification
description: What Aurel checks before and after an outgoing transaction.
---

Aurel checks the action you reviewed against the transaction your wallet is asked to sign. After you submit it, Aurel checks what the network recorded. These checks do not take control of your wallet or make a transaction reversible.

## Before signing

For supported transfers, Aurel checks that the wallet is linked to your account, the recipient and amount match your review, the asset contract is the one you selected, and your account controls allow the action. Value-based limits use a recent independent price observation. If a price, wallet link, or required security proof is missing, the transfer stops rather than using an estimate from your browser.

An approval, swap, lending action, or cross-network route needs its own reviewed transaction plan. A quote or preview alone cannot authorize a signature. Actions without a completed plan stay unavailable.

## After submission

A transaction hash means the wallet broadcast something; it does not prove that the expected transfer happened. Aurel compares the network transaction with the prepared call, checks the receipt and expected effect, and waits for the network's finality threshold. A chain reorganization or conflicting evidence can return a previously confirmed action to a pending or review state.

For a cross-network route, a source-network receipt does not prove destination delivery. That needs separate destination evidence.

## Older activity

Some older records were based on receipt checks alone. They remain in your history but are marked **Unverified** under the newer standard. Aurel will not silently present them as independently verified transfers.

## What these controls do not cover

You can still use your wallet outside Aurel. Aurel's limits and review steps do not freeze the wallet or apply to transactions made elsewhere. Always read the wallet prompt and check a new recipient through an independent channel.
