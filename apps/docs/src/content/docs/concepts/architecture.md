---
title: How Aura works
description: How the Aura app, your wallet, blockchains like Base, services like Aave and Morpho, and partners fit together when you move money.
---

Aura prepares money movements, checks them, and explains what happened. It isn't the ledger, custodian, bank, or exchange.

## How a money movement works

Every send, swap, move between networks, Earn deposit or withdrawal, and deposit to perps or predictions follows the same path. The progress card shows four steps: **Prepared**, **Confirmed**, **Submitted**, and **Completed**.

1. **You ask.** You choose what to do and how much, then review it.
2. **Prepared.** Aura's server checks the feature is on, applies your controls, and builds the exact transaction.
3. **Confirmed.** You approve it with your passkey.
4. **Submitted.** Privy sends it to the network and pays the network fee. The network accepts or rejects it.
5. **Completed.** Aura reads the blockchain itself before it marks anything completed, and keeps checking until the network makes it final. See [after you submit](/safety/security-model/#after-you-submit).

A quote isn't a transfer. A review isn't a confirmation. A submitted transaction isn't necessarily completed.

## The main parts

- **The app.** Where you see balances, move money, set controls, and get support.
- **Sign-in and your wallet.** Privy runs sign-in and makes a wallet for you, which is your account. It has the same address on every network. Aura's server checks your Privy sign-in on every request and never trusts an identity your browser claims.
- **Your controls.** If you turn them on, Aura applies your [account controls](/safety/account-controls/) to everything it prepares. They can't stop someone who uses an exported key or another app.
- **Blockchains and the services on them.** Base is the home network. Aura reads balances, positions, and receipts directly from the networks and from Aave's and Morpho's contracts. Earn uses Aave and two Morpho USDC vaults, all on Base. Perps run on Hyperliquid and predictions on Polymarket, in accounts your wallet owns. For swaps and moves between networks, LI.FI finds a way through third-party exchanges and transfer services.
- **Aura's own records.** Your settings, the transactions Aura prepared and the checks it ran, and your notifications. They make the app fast and explain what happened. They are never the final word on your balance. Intercom keeps support chats.
- **Background checks.** Scheduled checks spot stuck movements and problems processing partner updates. We use logs to investigate.

## Cloudflare

The app, its server, its database, and its background processing all run on Cloudflare. We still need backups, access control, careful database changes, monitoring, and tested incident plans.

## Room to change partners

Each partner sits behind a clear boundary, so we can change a wallet, exchange, card, or bank partner later. We don't hide real differences: a bank transfer and a blockchain transaction have different rules for cancelling, disputes, and finality, and Aura shows them differently.

## When something is missing, Aura stops

If Aura lacks a fact it needs for safety, it doesn't guess. It won't treat an unknown value as within your daily limit, or mark a move between networks complete because the first network confirmed it.

When a service Aura depends on is down, Aura shows the affected feature as unavailable and keeps the rest working. See [sources of truth](/concepts/sources-of-truth/).
