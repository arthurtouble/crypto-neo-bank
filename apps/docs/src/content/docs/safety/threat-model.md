---
title: Threat model
description: The main ways you or Aura could lose money, access, or reliable records, and what we do about each.
---

We start from what could go wrong for you, not from security slogans. The outcomes we most want to prevent are:

- someone moving your assets without your permission;
- you signing something different from what Aura showed you;
- your personal data being exposed;
- transaction records being lost without anyone noticing; and
- financial risk being presented in a misleading way.

## Someone takes over your account

An attacker might get into your email, social account, device, session, or recovery method. Privy runs sign-in and your wallet, and Aura checks every sign-in on its server.

If you've turned them on, your emergency lock, daily limit, and saved-recipients-only mode limit what a stolen session can do through Aura. You still need to keep your devices and recovery methods secure. Stronger sign-in methods reduce phishing risk, but they can't make a compromised device safe.

## Someone tampers with a transaction

A compromised web page, software library, route response, or partner could try to change a recipient, amount, or contract.

Aura builds each transaction on its server and keeps swap quotes there, so the browser can't swap in something else. After you confirm, Aura checks that what reached the blockchain matches what it prepared. If the review doesn't match what you meant to do, stop.

## Wrong recipients and scams

A valid address can belong to a scammer, be copied wrongly, or be swapped by malware on your clipboard. Saved recipients, saved-only mode, the wait before new recipients, clear names, and a daily limit are there to slow down risky first payments.

None of these can tell you whether the person on the other end is honest.

## A protocol fails

A contract can have a bug, be upgraded, get a bad price feed, run short of liquidity, or change through governance. A vault curator can lend to riskier markets. Building exact transactions on the server cuts the chance of touching an unknown contract. It can't make a protocol safe.

We keep our integrations narrow, watch for important changes, and stop preparing affected actions when we can't operate or review them safely.

## A stablecoin fails

Stablecoins can lose their peg, freeze addresses, change how redemption works, or run into issuer, reserve, banking, or regulatory problems. A balance shown in dollars isn't a promise you can redeem it for a dollar.

## A bridge or route fails

Moves between networks can depend on several contracts, liquidity sources, validators, messages, and relayers, chosen by LI.FI from third-party bridges and exchanges. Confirmation on the first network doesn't prove delivery. Aura marks a move complete only after it sees at least the minimum amount arrive.

## Someone on our team makes a mistake or misuses access

A staff member could misuse access, change settings, mishandle a support case, or expose logs. We keep customer and staff access separate, limit staff access to a named list, and keep signing out of Aura entirely.

That limits what any one of us can do. It doesn't replace access reviews, logging, change control, incident response, and oversight of our suppliers.

## Aura loses its records

Because blockchains and partners hold your actual money, losing Aura's database wouldn't change what you own. It could still erase your settings, case history, or transaction context. Backups, restore tests, add-only records, and checking against the source protect against this.

## A service we depend on goes down

Cloudflare, Privy, blockchain data services, LI.FI, Aave, Morpho, or a future partner could be unavailable. When that happens, Aura shows the affected feature as unavailable. It never treats a timeout as a completed action.

## Outside what Aura can do

Aura can't apply its controls after you export your key or use another app. It can't reverse a confirmed blockchain transaction, stop every phishing attack, guarantee a protocol, or recover a secret it never had.
