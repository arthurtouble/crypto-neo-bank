---
title: Redesign
description: The plan for step 2, the redesign of Aura's screens on top of the working flows.
---

Started on 28 September 2026, after every row in [feature readiness](feature-readiness.md) was done or cut. Step 2 of four: make it work, **redesign**, words (step 3), launch hardening with the final refactor (step 4). Update the status table in the same pull request that changes an area.

## Rules

- **Flows stay as they are.** The redesign changes how screens look and are laid out, not what they do: no changes to server logic, API contracts, D1, feature switches, or money rules. A needed behavior change goes to the product owner as its own pull request.
- **One area per pull request**, in the order below.
- **Tests keep passing.** Update selectors when markup changes, never the behavior a test checks. Don't delete a test to get green.
- **Copy stays**, unless a layout change forces a label to move or shorten.
- **Guest pages keep their labeled example data.**
- **Design system first.** Screens are built from [`docs/product/design-system.md`](../product/design-system.md) and `apps/web/public/design-system.html` (rewritten in phase 4). No one-off styles.

## Phases

1. **Inventory.** Every page, dialog, and state (loading, empty, error, disabled, signed out), desktop and mobile, with screenshots from dev or the e2e fake. Result: the [screen inventory](#screen-inventory) below.
2. **Journeys and wireframes.** The skeleton before colour or type: every journey as numbered steps, navigation, where each action lives, each screen's buttons, and what opens what (pages, drawers, sheets, dialogs), for desktop and mobile separately. Greyscale only. Result: [redesign-journeys.md](../product/redesign-journeys.md) and the storyboards in [redesign-wireframes.html](../product/redesign-wireframes.html), locked by the owner before phase 3. A journey that changes what a flow does is listed there as a behavior change and ships as its own pull request.
3. **Visual direction.** Colour, type, and style on the locked skeleton, with the owner's answers to the open questions. Result: [redesign-direction.md](../product/redesign-direction.md) and the mockup [redesign-visual.html](../product/redesign-visual.html). The three early mockups in [redesign-directions.html](../product/redesign-directions.html) are superseded.
4. **Design system.** Tokens (color, type, spacing, radius, elevation, motion), components, and patterns (money amounts, statuses, confirmations, lists, empty and error states), light and dark. Desktop and mobile share tokens but have separate components and flows. Replaces the design-system doc and reference page, adds a root `DESIGN.md` for coding agents, and ships as its own pull request before any screen.
5. **Screens.** Area by area, in the status table's order, built to the locked wireframes.
6. **Landing and public pages.** The landing page, the Aura tag pay page, the waitlist, and the docs site's look.

## Open questions for the product owner

On 28 September 2026 the owner set the brief: a clean break from today's design, which is only a map of the features, and an interface that is extremely professional, easy to use, streamlined, and fast. The questions (apps in scope, products liked, three words, what to keep, mobile first, wireframes or high fidelity, where design happens, brand assets, navigation) and their answers are in [redesign-direction.md](../product/redesign-direction.md#answers-to-the-open-questions).

## Definition of done for an area

- Built only from the new design system.
- Every state designed and built: loading, empty, error, unavailable data, disabled, and narrow screens.
- Accessible: keyboard use, focus, labels, contrast, reduced motion.
- Designed and built separately for desktop and mobile, with their own components and flow where the direction says so.
- Screenshots (desktop and mobile, light and dark) attached to the pull request.
- Docs that show or describe the screens (`docs/` and `apps/docs`) updated.
- `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and the area's e2e specs (desktop and mobile, selector changes only) pass.

## Order and status

| # | Area | Includes | Status |
| --- | --- | --- | --- |
| 1 | Inventory | Every screen and state, with screenshots and what's wrong today | Done ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)) |
| 2 | Journeys and wireframes | Every journey, navigation, placement, and flow between screens, drawers, sheets, and dialogs, desktop and mobile | Done ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)): locked by the owner on 29 September |
| 3 | Visual direction | Answers to the open questions; colour, type, and style; a one-page direction | Done ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)): ultramarine and Geist, picked by the owner on 29 September |
| 4 | Design system | Tokens, components, patterns; new `design-system.md`, `DESIGN.md`, `design-tokens.css`, and reference page | Done ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)) |
| 5 | App shell | Sidebar (desktop), menu button and sheet (phone), header, notifications inbox, toasts, sign-in and terms | Done ([#55](https://github.com/arthurtouble/crypto-neo-bank/pull/55)) |
| 6 | Overview | Balances, total, groups | Done ([#57](https://github.com/arthurtouble/crypto-neo-bank/pull/57)) |
| 7 | Money actions | Deposit, Send, Swap, and the shared review, passkey, and tracking steps | Done, in three pull requests to keep each reviewable: Deposit [#58](https://github.com/arthurtouble/crypto-neo-bank/pull/58), Send [#60](https://github.com/arthurtouble/crypto-neo-bank/pull/60), Swap [#61](https://github.com/arthurtouble/crypto-neo-bank/pull/61) |
| 8 | Earn | Positions and deposit and withdraw | Done ([#62](https://github.com/arthurtouble/crypto-neo-bank/pull/62)) |
| 9 | Cards and bank | Cards page, allowance, controls, card details, bank details and payouts | Done ([#63](https://github.com/arthurtouble/crypto-neo-bank/pull/63)); bank details and payouts were rebuilt with Deposit and Send ([#58](https://github.com/arthurtouble/crypto-neo-bank/pull/58), [#60](https://github.com/arthurtouble/crypto-neo-bank/pull/60)) |
| 10 | Transactions and Insights | List, filters, receipt, detail, export, statement, Insights | Done ([#65](https://github.com/arthurtouble/crypto-neo-bank/pull/65)) |
| 11 | Settings and support | Settings sections, passkey, limits, recipients, Aura tag, support | Done ([#66](https://github.com/arthurtouble/crypto-neo-bank/pull/66)) |
| 12 | Landing and public pages | Landing, `/pay/[tag]`, waitlist, docs site look | Done ([#67](https://github.com/arthurtouble/crypto-neo-bank/pull/67)); `/waitlist` only redirects to `/app`, so it has no look of its own. The pay page's B5 and B6 follow as their own pull requests |
| 13 | Operations console | `apps/ops`: the new look only, no layout redesign (decided 29 September) | Done ([#68](https://github.com/arthurtouble/crypto-neo-bank/pull/68)) |

Status values: Not started, In progress, Done (with the pull request link), Cut.

## Screen inventory

Captured on 28 September 2026 against the end-to-end fake, on desktop (1280) and a Pixel 7 (412), light and dark. `apps/web/tests/inventory/inventory.spec.ts` screenshots every page and state (`pnpm --filter @aurel/web exec playwright test -c playwright.inventory.config.ts`, into `output/inventory/`); the last screen of each desktop e2e test adds each flow's dialogs, errors, and results. The owner's gallery of both is linked from the pull request.

The brief is a clean break, so this records what each screen must do, not visual fixes. The friction noted in the old design is in [#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54) and this file's git history.

| Screen or dialog | Route | States seen | What it must do |
| --- | --- | --- | --- |
| Landing | `/` | Default, dark, phone menu | Explain Aura, link to the app and docs, FAQ, footnotes. |
| Aura tag pay page | `/pay/[tag]` | Found, unknown tag | Show a public payee's address and QR code. |
| Terms gate | `/app` (first sign-in) | Unchecked, checked | Accept terms and privacy before anything else. |
| Session expired | `/app` | Expired | Ask to sign in again. |
| App shell | all `/app` | Guest, signed in, nav open on phone, search (⌘K), notifications | Navigation, search, notifications, theme, sign in and out. |
| Overview | `/app` | Guest, loading, empty, funded, partial (chain or price down), error, locked, dark | Total in dollars, five groups (cash, crypto, stocks, metals, earn), unavailable values left out of the total and said so, Deposit and Send. |
| Deposit | `/app/deposit` | Guest, loading, empty, switched off, error, dark | Receive by address and QR, add from a connected wallet (Base or another network, with fees shown first), pay by card, bank details and deposits through Bridge. |
| Send | `/app/send` | Guest, loading, empty, switched off, dialog, invalid input, saved recipient, review, complete, unknown tag, bank form, locked, dark | To an address, saved recipient, own wallet, or Aura tag; other networks through LI.FI; bank payouts; passkey; limits and waiting periods. |
| Swap | `/app/swap` | Guest, loading, switched off, asset picker, quote, error, dark | Any registered asset, both ways, other networks, slippage, quote expiry, tracked bridge delivery. |
| Earn | `/app/earn` | Guest, loading, empty, switched off, deposit form, rates unavailable, dark | Aave and two Morpho vaults with rates, liquidity, deposits, withdraw and withdraw all, live-growing positions. |
| Cards | `/app/cards` | Guest, coming soon (off), not verified, card, frozen, details, dispute form, dark | Apply with Bridge, create a virtual card, allowance, freeze, daily limit, card details after passkey, card activity, disputes, phone wallets. |
| Transactions | `/app/transactions` | Guest, loading, empty, list, receipt, statement, partial (transfers down), dark | History with search and filters, receipts, CSV export, monthly statement, network links. |
| Transaction detail | `/app/transactions/[id]` | Sent | The full journey of one action, from the receipt's "Full history". |
| Insights | `/app/insights` | Guest, loading, empty, with data, table, unavailable, dark | Money in and out over time, top card merchants, periods (7D to 1Y). |
| Settings | `/app/settings` | Guest, loading, funded, no passkey, locked, dark | Sign-in and passkey, transaction controls and lock, saved recipients, Aura tag, notifications, this device, data download, account closing. |
| Support | `/app/support` | Guest, loading, dark | Chat (Intercom), help articles, report a problem. |
| Not found | any unknown route | Default | |
| Design system reference | `/design-system.html` | Default | Replaced in phase 4 by the new reference page. |
| Ops: signed out | ops `/` | Without an Access token | |
| Ops: Customers | ops `#customers` | List, one customer, lock form | Find, list, lock, close, reopen, each with a reason. |
| Ops: Money movement | ops `#movement` | Feed, action journey | Every customer's transactions, filters, journey, chain check. |
| Ops: Stats | ops `#stats` | Default | Customers, activity, new-customer funnel. |
| Ops: Controls | ops `#controls` | Default | Feature switches, asset pauses, issues. |
| Docs site | docs Worker | Home, guide, legal, not found, nav, dark | Starlight defaults with Aura colours. |
