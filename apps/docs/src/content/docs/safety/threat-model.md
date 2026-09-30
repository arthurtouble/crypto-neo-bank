---
title: Threat model
description: The main ways you or Aura could lose money, access, or reliable records, and what we do about each.
---

We start from what could go wrong for you, not from security slogans. These are the outcomes we most want to prevent:

- someone moving your assets without your permission;
- you signing something different from what Aura showed you;
- your personal data being exposed;
- transaction records being lost without anyone noticing; and
- financial risk being presented in a misleading way.

## Someone takes over your account

An attacker might get into your email, social account, device, session, or recovery method. Privy runs sign-in and your wallet, and our server checks every sign-in.

If you've turned them on, your emergency lock, daily limit, and saved-recipients-only mode limit what a stolen session can do through Aura. Loosening them needs your passkey, which a stolen session doesn't have. You still need to keep your devices and recovery methods secure. Stronger sign-in methods reduce phishing risk, but they can't make a compromised device safe.

## Someone tampers with a transaction

A compromised web page, software library, route response, or partner could try to change a recipient, amount, or contract. A route response is the quote we get for a swap or a move between networks.

We build each transaction on our server and keep swap quotes there, so the browser can't swap in something else. After you confirm, we check that what reached the blockchain matches what we prepared. If the review doesn't match what you meant to do, stop.

## Wrong recipients and scams

A valid address can belong to a scammer. It can also be copied wrongly, or swapped by malware on your clipboard. Saved recipients, saved-only mode, the wait before new recipients, clear names, and a daily limit are there to slow down risky first payments.

None of these can tell you whether the person on the other end is honest.

## A protocol fails

A contract can have a bug, be upgraded, get a bad price feed, run short of liquidity, or change through governance. A vault curator, who chooses where a vault lends, can lend to riskier markets. Building exact transactions on the server cuts the chance of touching an unknown contract. It can't make a protocol safe.

We keep our integrations narrow and watch for important changes. We stop preparing affected actions when we can't operate or review them safely.

## A stablecoin fails

Stablecoins can lose their peg, freeze addresses, change how redemption works, or run into issuer, reserve, banking, or regulatory problems. A balance shown in dollars isn't a promise you can redeem it for a dollar.

## A bridge or route fails

A move between networks can depend on several contracts, liquidity sources, validators, messages, and relayers. LI.FI chooses these from third-party bridges and exchanges. Confirmation on the first network doesn't prove delivery. We mark a move complete only after we see at least the minimum amount arrive.

## Someone on our team makes a mistake or misuses access

A staff member could misuse access, change settings, mishandle a support chat, or expose logs. We keep customer and staff access separate and limit staff access to a named list. We record who made each change. We keep signing out of Aura entirely. Staff can lock your account to protect it, but only you can unlock it, with your passkey.

That limits what any one of us can do. It doesn't replace access reviews, logging, change control, incident response, and oversight of our suppliers.

## Aura loses its records

Blockchains and partners hold your actual money, so losing our database wouldn't change what you own. It could still erase your settings, case history, or transaction context. We protect against this with backups, restore tests, records we only add to and never edit, and checks against the source.

## A service we depend on goes down

Cloudflare, Privy, blockchain data services, LI.FI, Aave, Morpho, or a future partner could be unavailable. When that happens, we show the affected feature as unavailable. We never treat a timeout as a completed action.

## Outside what Aura can do

We can't apply our controls after you export your key or use another app. We can't reverse a confirmed blockchain transaction, stop every phishing attack, guarantee a protocol, or recover a secret we never had.
