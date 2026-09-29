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

Five destinations instead of today's ten. Every current route keeps working and opens the matching place.

| | Desktop | Phone |
| --- | --- | --- |
| Primary | Icon rail: Home, Activity, Earn, Cards; Account at the bottom | Bottom tabs: Home, Activity, Move, Cards, Account |
| Money actions | **Move money** button in the top bar, on every page | **Move** in the middle of the tab bar opens a sheet: Add money, Send, Swap, Earn |
| Search | ⌘K from anywhere: pages and actions | Search inside Activity |
| Notifications | Bell in the top bar, opens a popover | Bell on Home, opens a screen |
| Account | Avatar menu: Security, Recipients, Aura tag, Notifications, This device, Your data, Help, Log out | Account tab with the same rows and Log out |

Where today's sections go:

| Today | Redesign |
| --- | --- |
| Overview | Home |
| Deposit | Move money › Add (`/app/deposit` opens it) |
| Send | Move money › Send (`/app/send` opens it) |
| Swap | Move money › Swap (`/app/swap` opens it) |
| Earn | Earn (desktop rail; on the phone, from Home and Move) |
| Cards | Cards |
| Transactions | Activity › Transactions |
| Insights | Activity › Insights (`/app/insights` opens it) |
| Settings | Account |
| Support | Account › Help |

## Shared patterns

These repeat across journeys. Each is one component per device in phase 4.

1. **Move money.** Desktop: a drawer on the right over the current page, with tabs Add, Send, Swap. The page underneath keeps its state. Phone: full-screen steps, one decision per screen, launched from the Move sheet.
2. **Amount first.** Money actions start with the amount and asset, then who or where. On the phone the amount is a keypad screen.
3. **Review, then passkey.** Every money action ends on a review that says exactly what moves, where, and what it costs. Then the primary button opens the device's passkey prompt. Cancelling keeps the review open and says nothing moved.
4. **Progress where it started.** After confirming, the same drawer or screen shows progress, then the result. Closing it is always safe. The action stays in Activity, and the bell and a toast report the result.
5. **Blocked up front.** Anything known before the customer starts shows first, with one next step: locked account, no passkey, a feature switched off, an asset paused. Examples: "Go to security" or "Add passkey". Checks only the server can make (daily limit, saved-recipients-only, waiting period, quotes) come back on the review with the same one next step.
6. **Details in a drawer or a pushed screen.** Receipts, asset details, and vaults open in a side drawer on desktop, so the list stays in view. On the phone they open as a pushed screen with a back button.
7. **Pickers and menus.** Desktop: in the drawer or a popover. Phone: a full screen for long lists (assets, recipients), a bottom sheet for short ones (Move, Export, sign-in).
8. **Loading, unavailable, empty.** Loading is a skeleton of the real layout. Data that can't be read says Unavailable and names what's left out; it's never an old value or zero. An empty section says what will appear and offers the action that fills it.
9. **Guests.** The same screens with fictional data and a banner saying so. Every action opens sign-in, then returns to what was tapped.
10. **Setup as a checklist.** Anything that takes several steps across providers is a short checklist with one current step and its one button. This covers bank verification, getting a card, and the first-run passkey and email.

## Journeys

Each journey is drawn step by step in the storyboards. The frame numbers (J5.3 and so on) match.

### Get started

- **J1 Explore as a guest.** The real Home with example data and a banner. Any action opens sign-in (a dialog on desktop, a sheet on the phone).
- **J2 Sign in and accept the terms.** Sign-in (Privy, email or wallet), then the terms on their own full screen. There's no app shell behind it; the three documents are rows and the checkbox is required. Then:
  - A first Home with the four ways to add money.
  - A "Secure your account" checklist: add a passkey, add an email.
  - A session that expires shows one banner on the current page.
  - A closed account replaces every page except Help.
  - Money left in a previous account shows as a Home banner with "Move everything".

### Home

- **J3 Check my money.** Total value with when it was read and what it leaves out. Then:
  - Group filters with their totals, and one holdings table (desktop) or list (phone).
  - Desktop only: recent activity beside the table.
  - Phone only: four quick actions under the total.
  - A holding opens its detail, with Send, Swap, and Add for that asset.

### Move money

- **J4 Add money.** One list of every way in, each saying what it needs:
  - **Receive:** QR, address, copy, and the network warning. The list of assets that show up when received comes from the registry.
  - **From your wallet:** connect, then network, asset, and amount. Another network adds a fee review, and the price expires.
  - **With a card:** Privy's card flow.
  - **From a bank:** a three-step checklist (verify with Bridge, Bridge reviews, details ready), then account details with copy buttons.
- **J5 Send crypto.** Amount and asset, then the recipient:
  - Saved, own wallets, and recent as faces; paste an address or type an @tag.
  - A new address can be saved with a name.
  - Another network shows what arrives after fees.
  - Then review, passkey, and the result. Base makes it final in about 20 minutes; cross-network ends at "Sent" and is followed in Activity.
- **J6 Send to a bank.** A bank account is a recipient type in Send. The customer chooses or adds a bank, then enters the amount in USD and picks the speed. After the passkey, the result is a timeline of Bridge's steps, the same one the receipt shows later.
- **J7 Swap.** You pay (only what the account holds) and You receive (every supported asset on every network), with slippage as a small setting. The quote:
  - has a countdown, and Refresh at zero;
  - lists the minimum received and fees;
  - gives stocks, gold, and the euro a reference price, with a warning when the quote is more than 2% away.
  When there's no quote, the page says why in place.
- **J8 Earn.** Positions first, growing live, then every vault with rate, withdrawable now, and total deposits. A vault opens with Deposit and Withdraw (and Withdraw all where it applies). Review and passkey work as in Send.

### Cards

- **J9 Get a card.** A checklist: verify with Bridge (shared with the bank), apply, create (passkey), and set a spending allowance (a money action). "Coming soon" replaces it when cards are switched off.
- **J10 Use and control my card.** The card, with Show details (passkey), Freeze, and Add to phone. Allowance and daily limit sit beside it, card activity below. Freezing and lowering apply at once; unfreezing and raising need the passkey.
- **J11 Dispute a card payment.** From a settled payment's receipt: the reason, and 10 to 1,000 characters of detail. It can be sent once. The receipt then shows the dispute's status.

### Activity

- **J12 Find and understand a transaction.** Transactions and Insights are tabs of one section. The list has search, type chips, a status filter, and Export. A missing source is named in a banner. A row opens its receipt, with its journey timeline, network links, and Full history.
- **J13 Export and statements.** Three files: this list, the tax-support preview, and a monthly statement. A month that can't be complete is refused.
- **J14 See where my money went.** Periods, money in and out, and a chart with a table view. Top card merchants below. A series that can't be read is left out and named.

### Account

- **J15 Keep my account safe.** The passkey first, then email, emergency lock, daily limit, saved-recipients-only, the waiting period, and the wallet key. Saved recipients are their own area. Tightening is instant; loosening needs the passkey.
- **J16 My profile and preferences.** Aura tag and its payment page, notifications, this device (theme, hide balances), and your data. Your data covers download, terms, and asking to close the account.
- **J17 Get help.** Chat (Intercom), articles, and "Report a problem": lock and tell us, or tell us about money sent to a scam.
- **J18 Notifications.** An inbox that marks itself read. Each notice opens where it happened. Toasts appear only for money received and security changes.

### Public

- **J19 Pay someone by their Aura tag.** The public page shows only the ways that work: crypto always, bank details if shared. "Send with Aura" opens Send with the tag filled in.

## Behavior changes

These change what a flow does, not just how it looks. Each needs the owner's yes and ships as its own pull request, before or alongside the screen it touches.

| # | Change | Where | Why |
| --- | --- | --- | --- |
| B1 | A review step before the passkey for bank payouts | J6.3 | Every other money action has one; today "Review and send" goes straight to the passkey. |
| B2 | A check step for a first-time address in Send | J5.3 | The most common costly mistake is a wrong address; Coinbase Wallet does this. |
| B3 | Receive lists every asset the account shows when it arrives on Base, from the registry | J4.2 | Today the copy names USDC, ETH, and cbBTC; EURC, WETH, and the tokenized stocks arrive and show too. Copy that comes from data, so it's listed here rather than left to step 3. |
| B4 | ⌘K search includes actions (Send, Add, Swap, lock account), not only pages | Navigation | A faster way to act on desktop. Client-only. |
| B5 | "Send with Aura" on the public pay page, opening Send with the tag | J19 | Aura customers paying each other. It uses the existing `sendTo` and `tag` link. |
| B6 | Card payment removed from the public pay page until it exists | J19 | Today it always shows as unavailable. |

Moving Insights under Activity and Deposit, Send, and Swap into Move money is navigation, not behavior: the routes stay and every e2e step still exists.

## Decisions for the owner

1. Lock the navigation: five destinations and Move money, as above.
2. Yes or no to B1 to B6.
3. Keep Review as its own step on desktop, or confirm from the form with the summary always visible (J5)?
4. Scan a QR code to fill an address on the phone (needs the camera, which is new)?
5. Guests: every section browsable, or Home plus one example of each action (J1)?
6. Pay by card: keep Privy's flow as an overlay, or explain it on our own screen first (J4)?
7. The ops console: new tokens and components only, no layout work (the proposed answer in the [direction](redesign-direction.md))?
