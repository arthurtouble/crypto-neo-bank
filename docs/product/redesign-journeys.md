---
title: Redesign journeys and wireframes
description: Phase 2 of the redesign. The product skeleton, before any visual design: every customer journey, the navigation, where each action lives, and what opens what, on desktop and mobile.
---

Phase 2 of [the redesign](../overview/redesign.md), written on 29 September 2026. The storyboards are in [`redesign-wireframes.html`](redesign-wireframes.html): every journey as numbered greyscale frames for desktop and phone, with notes. This document is the written spec behind them. When the owner locks it, phase 3 (visual direction) starts, and screens are later built to it.

The owner's brief: settle the story, the journeys, and the wireframes for every customer action first. That means positions, buttons, how screens, drawers, sheets, and dialogs lead into each other. Colour, type, and style come after. Desktop and mobile share a theme but each gets its own navigation, components, and flow.

The journeys are drawn from what the app does today (the [inventory](../overview/redesign.md#screen-inventory) and the e2e specs). Where a journey would change what a flow does, it's listed under [Behavior changes](#behavior-changes) and needs the owner's yes and its own pull request.

## What people come to do

| Job | Journeys |
| --- | --- |
| See what I have and what it's worth | J3 |
| Get money in | J4 |
| Pay someone, or cash out to my bank | J5, J6, J19 |
| Convert between assets or networks | J7 |
| Earn on idle money | J8 |
| Spend with a card | J9, J10, J11 |
| Know what happened, and prove it | J12, J13, J14, J18 |
| Keep my account safe | J15 |
| Set myself up, get help | J1, J2, J16, J17 |

## Navigation

Decided on 29 September 2026: keep the ten sections, not grouped.

| | Desktop | Phone |
| --- | --- | --- |
| Sections | Overview, Deposit, Send, Swap, Earn, Cards, Transactions, Insights, Settings, Support | The same ten |
| How to get there | A sidebar listing all ten, each with an icon and its name, always visible, no group headings | No tab bar. A round menu button floats at the bottom centre of every section page. It opens a sheet from the bottom with the ten sections as tiles, three per row, each with an icon and its name. It hides during a step so it never covers a button. |
| Search | ⌘K from anywhere: pages and actions (B4) | Search inside Transactions |
| Notifications | Bell in the top bar, opens a popover | Bell in the header of each section page, opens a screen |
| Account | Avatar menu: email, theme, log out | Log out in the menu sheet's footer |

Deposit, Send, and Swap stay full pages. There's no separate Move money drawer or button; the sidebar and menu reach them, and Overview's quick buttons open them.

## Shared patterns

These repeat across journeys. Each is one component per device in phase 4.

1. **Money actions are pages.** Deposit, Send, and Swap are full pages. Desktop: the form on the left, a live summary on the right. Phone: full-screen steps, one decision per screen, with the menu button hidden until the step ends.
2. **Amount first.** Money actions start with the amount and asset, then who or where. On the phone the amount is a keypad screen.
3. **Review, then passkey.** Every money action ends on a review that says exactly what moves, where, and what it costs. Then the primary button opens the device's passkey prompt. Cancelling keeps the review open and says nothing moved.
4. **Progress where it started.** After confirming, the same page or screen shows progress, then the result. Leaving is always safe. The action stays in Transactions, and the bell and a toast report the result.
5. **Blocked up front.** Anything known before the customer starts shows first, with one next step: locked account, no passkey, a feature switched off, an asset paused. Examples: "Go to security" or "Add passkey". Checks only the server can make (daily limit, saved-recipients-only, waiting period, quotes) come back on the review with the same one next step.
6. **Details in a side panel or a pushed screen.** Receipts, asset details, and vaults open in a side panel on desktop, so the list stays in view. On the phone they open as a pushed screen with a back button.
7. **Pickers and menus.** Desktop: a side panel or a popover. Phone: a full screen for long lists (assets, recipients), a bottom sheet for short ones (the menu, Export, sign-in).
8. **Loading, unavailable, empty.** Loading is a skeleton of the real layout. Data that can't be read says Unavailable and names what's left out; it's never an old value or zero. An empty section says what will appear and offers the action that fills it.
9. **Guests.** Every section, with fictional data and a banner saying so (decided). Every action opens sign-in, then returns to what was tapped.
10. **Setup as a checklist.** Anything that takes several steps across providers is a short checklist with one current step and its one button. This covers bank verification, getting a card, and the first-run passkey and email.

## Journeys

Each journey is drawn step by step in the storyboards. The frame numbers (J5.3 and so on) match.

### Get started

- **J0 Get around.** The desktop sidebar with the ten sections. On the phone, the floating menu button and the sheet of ten tiles.
- **J1 Explore as a guest.** Every section with example data and a banner. Any action opens sign-in (a dialog on desktop, a sheet on the phone).
- **J2 Sign in and accept the terms.** Sign-in (Privy, email or wallet), then the terms on their own full screen. There's no app shell behind it; the three documents are rows and the checkbox is required. Then:
  - A first Overview with the four ways to deposit.
  - A "Secure your account" checklist: add a passkey, add an email.
  - A session that expires shows one banner on the current page.
  - A closed account replaces every page except Support.
  - Money left in a previous account shows as an Overview banner with "Move everything".

### Overview

- **J3 Check my money.** Total value, with when it was read and what it leaves out. Then:
  - Group filters with their totals, and one holdings table (desktop) or list (phone).
  - Desktop only: recent transactions beside the table.
  - Phone only: quick buttons for Deposit, Send, Swap, and Earn.
  - A holding opens its detail, with Send, Swap, and Deposit for that asset.

### Money

- **J4 Deposit.** A page with four ways in: Receive, From a wallet, Card, and Bank. They're tabs on desktop and rows on the phone.
  - **Receive:** QR code and address, plus the assets that show up, from the registry (B3).
  - **From a wallet:** fees are reviewed for other networks.
  - **Card:** our short screen first, then the provider's flow.
  - **Bank:** a three-step checklist with Bridge, then account details with copy buttons.
- **J5 Send crypto.** A page. Desktop has the form and a live summary side by side; the phone goes amount, then who, then review.
  - **Who:** saved recipients, your own wallets, and recent addresses as faces, or paste an address or @tag. QR scan comes later.
  - **New address:** it can be saved with a name, and gets a check step the first time (B2).
  - **Another network:** the summary shows what arrives after fees.
  - **Review:** always its own step, then the passkey, then the result.
- **J6 Send to a bank.** The second tab of Send. Choose or add a bank, then amount in USD and speed, then a review (B1) and the passkey. The result is a timeline of Bridge's steps.
- **J7 Swap.** A page. You pay (what you hold) and You receive (every supported asset), with slippage as a small setting. The quote has a countdown, the fees, and reference-price warnings. When there's no quote, the page says why.
- **J8 Earn.** Positions first, growing live, then every vault. A vault opens with Deposit and Withdraw. Review and passkey work as in Send.

### Cards

- **J9 Get a card.** A checklist: verify with Bridge (shared with the bank), apply, create (passkey), set a spending allowance. "Coming soon" when cards are switched off.
- **J10 Use and control my card.** The card with Show details (passkey), Freeze, and Add to phone, plus the allowance, the daily limit, and card activity. Tightening is instant; loosening needs the passkey.
- **J11 Dispute a card payment.** From a settled payment's receipt: the reason and details. It can be sent once.

### Records

- **J12 Find and understand a transaction.** The Transactions page: search, type chips, status filter, and Export. A missing source is named in a banner. A row opens its receipt with its timeline and network links.
- **J13 Export and statements.** This list, the tax-support preview, and the monthly statement.
- **J14 See where my money went.** The Insights page: periods, money in and out, a chart with a table view, and top card merchants.

### Settings and support

- **J15 Keep my account safe.** Settings › Security: the passkey first, then email, emergency lock, daily limit, saved-recipients-only, and the wallet key. Saved recipients are their own area. Tightening is instant; loosening needs the passkey.
- **J16 My profile and preferences.** Settings › Aura tag and payment page, notifications, this device, and your data (download, terms, close the account).
- **J17 Get help.** The Support page: chat, articles, and report a problem.
- **J18 Notifications.** An inbox that marks itself read. Each notice opens where it happened. Toasts only for money received and security changes.

### Public

- **J19 Pay someone by their Aura tag.** Only the ways that work (B6), and "Send with Aura" (B5).

## Behavior changes

These change what a flow does, not just how it looks. The owner approved all six on 29 September 2026. Each ships as its own pull request, before or alongside the screen it touches.

| # | Change | Where | Status |
| --- | --- | --- | --- |
| B1 | A review step before the passkey for bank payouts | J6.4 | Done ([#69](https://github.com/arthurtouble/crypto-neo-bank/pull/69)) |
| B2 | A check step for a first-time address in Send: the address in chunks, the network, and a test-send hint. Saved recipients and own wallets skip it. | J5.4 | Approved |
| B3 | Receive lists every asset that shows up when received on Base, from the registry. Today the copy names only USDC, ETH, and cbBTC. | J4.1 | Approved |
| B4 | ⌘K search includes actions (Send, Deposit, Swap, lock account), not only pages | J0.1 | Approved |
| B5 | "Send with Aura" on the public pay page, opening Send with the tag, using the existing `sendTo` and `tag` link | J19 | Approved |
| B6 | Card payment removed from the public pay page until it exists | J19 | Approved |

## Decisions

Answered by the owner on 29 September 2026.

| Question | Decision |
| --- | --- |
| Navigation | Keep ten sections, not grouped. Desktop: a sidebar, with an icon and a name for each. Phone: no bottom navigation. A floating button at the bottom centre opens a sheet of ten tiles, three per row. |
| Deposit, Send, and Swap | Full pages. No Move money drawer or top-bar button. |
| Review in Send on desktop | Its own step, as on the phone. |
| Scan a QR code on the phone | Yes, later. The place for it is kept in Send, and it's built after launch. |
| Guests | Every section, with labeled example data. |
| Pay by card | Our short screen first, then the provider's flow. |
| Ops console | The new look only, with no layout redesign. |
| B1 to B6 | All approved. |

The owner confirmed the storyboards on 29 September 2026. Phase 2 is locked: screens are built to these journeys, and changes to them go through the owner.
