---
title: Architecture
description: How the app, your wallet, blockchains, protocols, and partners fit together.
---

Aura is a thin layer. It prepares money movements, checks them, and explains what happened. It doesn't try to be the ledger, the custodian, the bank, and the exchange all at once.

## How a money movement works

Every send, swap, move between networks, Earn deposit or withdrawal, and crypto purchase follows the same path:

1. **You ask.** You choose what to do and how much.
2. **Aura prepares and checks it.** Aura's server checks that the feature is on and applies any controls you've set. Then it builds the exact transaction.
3. **You sign.** Your wallet shows the transaction. Any token approval and the action itself are signed together, as one operation.
4. **The network settles it.** The blockchain accepts or rejects the operation.
5. **Aura checks the result.** Aura reads the blockchain itself. It marks the movement complete only when the operation matches what was prepared, is final, and shows the expected transfer or deposit. A move between networks also has to arrive.

Each step is separate. A quote isn't a transfer. A wallet prompt isn't a signature. A submitted transaction isn't necessarily final.

## The main parts

### The app

The web app is where you see balances, move money, set controls, and get support.

### Sign-in and your wallet

Privy runs sign-in and your wallet. Your account is a smart wallet on Base that you control through your Privy sign-in. It holds your funds and signs each action as one batched operation. Aura may cover its network fees on Base.

Aura's server checks your Privy sign-in on every request. It never trusts an identity your browser claims.

### Your controls

If you turn them on, Aura applies your account lock, daily limit, saved-recipients-only mode, and the wait before new recipients. They're all off by default.

These checks can stop a movement inside Aura. They can't stop someone who uses an exported key or another app.

### Blockchains and protocols

Base is the home network. Aura reads balances, positions, and transaction receipts directly from the networks and protocol contracts.

- **Earn** uses Aave on Base and Sky savings on Ethereum.
- **Swaps and moves between networks** use routes found by LI.FI, which chooses among third-party bridges and exchanges.

### Aura's own records

Aura keeps records such as your settings, the transactions it prepared and the checks it ran, and your support cases. They make the app fast and let us explain what happened. They are never the final word on your balance.

### Background checks

Aura runs scheduled checks that spot stuck movements and problems processing partner updates. Logs help us investigate.

## Why Cloudflare

Aura runs on Cloudflare. The app, its server, its database, and its background processing all run in one place.

That keeps things simple. We still need backups, access control, careful database changes, monitoring, and tested incident plans.

## Room to change partners

Aura keeps each partner behind a clear boundary, so we can change a wallet, route, card, or bank partner later.

We don't hide real differences, though. A bank transfer and a blockchain transaction have different rules for cancelling, disputes, and finality, and Aura shows them differently.

## When something is missing, Aura stops

If Aura is missing a fact it needs for safety, it doesn't guess. It won't treat an unknown value as within your daily limit. It won't mark a move between networks complete just because the first network confirmed it.

When a service Aura depends on is down, Aura shows the affected feature as unavailable and keeps the rest working. See [sources of truth](/concepts/sources-of-truth/).
