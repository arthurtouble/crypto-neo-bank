---
title: Redesign
description: The plan for step 2, the redesign of Aura's screens on top of the working flows.
---

Started on 28 September 2026, after every row in [feature readiness](feature-readiness.md) was done or cut. This is the working plan until the redesign is done. Update the status table in the same pull request that changes an area.

It is step 2 of the four-step plan in feature readiness: make it work, **redesign**, words, launch hardening. Copy rewrites (step 3) and the final refactor (step 4) are not part of it.

## Rules

- **The flows stay as they are.** The redesign changes how screens look and are laid out, not what they do. No changes to server logic, API contracts, D1, feature switches, or money rules. If a design needs a behavior change, raise it with the product owner as its own pull request.
- **One area per pull request**, in the order below.
- **Tests keep passing.** Existing end-to-end specs cover every customer step. Update selectors when markup changes, never the behavior a test checks. Don't delete a test to get green.
- **Copy stays as it is**, unless a layout change forces a label to move or shorten. Step 3 rewrites it.
- **Guest pages keep their labeled example data.**
- **The design system comes first.** [`docs/product/design-system.md`](../product/design-system.md) and the reference page `apps/web/public/design-system.html` are rewritten in phase 3, and screens are built from them. Don't make one-off styles in a screen.

## Phases

1. **Inventory.** Every page, dialog, and state (loading, empty, error, disabled, signed out), on desktop and mobile, with screenshots from dev or the e2e fake. The result is the screen list below, filled in, and a short note of what's wrong today.
2. **Direction.** The product owner answers the open questions below. The result is a one-page direction: character, references, what to keep, what to drop. It is [redesign-direction.md](../product/redesign-direction.md), with three mockups to choose from in [redesign-directions.html](../product/redesign-directions.html).
3. **Design system.** Tokens (color, type, spacing, radius, elevation, motion), components, and patterns (money amounts, statuses, confirmations, lists, empty and error states), in light and dark. Desktop and mobile share the tokens but have separate components and flows (see the direction). It replaces the current design-system doc and reference page, adds a root `DESIGN.md` that coding agents read, and ships as its own pull request before any screen.
4. **Screens.** Area by area, in the order of the status table.
5. **Landing and public pages.** The landing page, the Aura tag pay page, the waitlist, and the docs site's look.

## Open questions for the product owner

To answer in phase 2, before any design work. On 28 September 2026 the owner set the brief: a clean break from today's design, which is only a map of the features, and an interface that is extremely professional, easy to use, streamlined, and fast. The answers, and proposed answers where the owner hasn't given one yet, are in [redesign-direction.md](../product/redesign-direction.md#answers-to-the-open-questions).

| Question | Answer |
| --- | --- |
| Which apps are in scope: the customer app, the landing page, the docs site, the ops console? | |
| Two or three products whose look and feel you like, and what about each | |
| What should Aura feel like, in three words? Does the current "calm, exact, discreet" character still hold? | |
| What to keep from today's design (fonts, colors, layout, anything) | |
| Mobile first, or desktop and mobile equally? Is a native app planned? | |
| Wireframes first, or straight to high-fidelity? | |
| Where design happens: a design tool (Figma, Claude Design) or directly in code | |
| Brand assets that exist or are needed: logo, icon, illustrations | |
| Navigation: which sections are primary, which live under a menu | |

## Definition of done for an area

- Built only from the new design system; no one-off styles.
- Every state designed and built: loading, empty, error, unavailable data, disabled, and narrow screens.
- Accessible: keyboard use, focus, labels, contrast, reduced motion.
- End-to-end specs for the area pass on desktop and mobile, with updated selectors only.
- Designed and built separately for desktop and mobile, each with its own components and flow where the direction says so.
- Screenshots of the area (desktop and mobile, light and dark) attached to the pull request.
- Docs that show or describe the screens (`docs/` and `apps/docs`) updated.
- `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and the area's e2e specs pass.

## Order and status

| # | Area | Includes | Status |
| --- | --- | --- | --- |
| 1 | Inventory | Every screen and state, with screenshots and what's wrong today | Done ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)) |
| 2 | Direction | Answers to the open questions; a one-page direction | In progress ([#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)): waiting for the owner to pick a direction |
| 3 | Design system | Tokens, components, patterns; new `design-system.md` and reference page | Not started |
| 4 | App shell | Navigation, header, account menu, notifications inbox, toasts, sign-in and terms | Not started |
| 5 | Overview | Balances, total, groups | Not started |
| 6 | Money actions | Deposit, Send, Swap, and the shared review, passkey, and tracking steps | Not started |
| 7 | Earn | Positions and deposit and withdraw | Not started |
| 8 | Cards and bank | Cards page, allowance, controls, card details, bank details and payouts | Not started |
| 9 | Transactions and Insights | List, filters, receipt, detail, export, statement, Insights | Not started |
| 10 | Settings and support | Settings sections, passkey, limits, recipients, Aura tag, support | Not started |
| 11 | Landing and public pages | Landing, `/pay/[tag]`, waitlist, docs site look | Not started |
| 12 | Operations console | `apps/ops` screens, if in scope | Not started |

Status values: Not started, In progress, Done (with the pull request link), Cut.

## Screen inventory

Captured on 28 September 2026 against the end-to-end fake, on desktop (1280) and a Pixel 7 (412), in light and dark. `apps/web/tests/inventory/inventory.spec.ts` takes the screenshots of every page and state (`pnpm --filter @aurel/web exec playwright test -c playwright.inventory.config.ts`, into `output/inventory/`). The final screen of each desktop e2e test adds the dialogs, errors, and results of every flow. The owner has a browsable gallery of both, linked from the pull request.

The owner's brief (see [redesign-direction.md](../product/redesign-direction.md)) is a clean break from today's design, so this list records what each screen must do, and the friction the new design should remove. It is not a list of visual fixes.

Across the app today:

- Ten sections in a sidebar, and each money action is its own page that opens a dialog, so sending takes a page change and a dialog before the amount.
- Guest pages are separate example screens (three big-number cards on the guest Overview) rather than the real layout with example data.
- Loading is a spinner and a sentence inside an empty box. Earn shows "Unavailable" while rates are still loading.
- Visual debt: 21 corner radii, about 40 font sizes, 150 literal colours, four breakpoints, and `:root` redefined four times across three style sheets. Native selects and checkboxes are unstyled.
- Dialogs open mid-page with a blurred backdrop and can start above the top of the screen. Toasts cover the header.
- The header shows "Secure Connection", which describes nothing the customer can act on. The sidebar footer's name is white on the light sidebar and clips on short screens.

| Screen or dialog | Route | States seen | What it must do, and friction to remove |
| --- | --- | --- | --- |
| Landing | `/` | Default, dark, phone menu | Explain Aura, link to the app and docs, FAQ, footnotes. Generic hero and feature blocks; unrelated to the app's look. |
| Aura tag pay page | `/pay/[tag]` | Found, unknown tag | Show a public payee's address and QR code. Always lists bank and card as unavailable, which is noise for the payer. |
| Terms gate | `/app` (first sign-in) | Unchecked, checked | Accept terms and privacy before anything else. Shown inside the full app shell with live navigation behind it; the document links don't read as links. |
| Session expired | `/app` | Expired | Ask to sign in again. |
| App shell | all `/app` | Guest, signed in, nav open on phone, search (⌘K), notifications | Navigation, search, notifications, theme, sign in and out. Ten flat destinations; a separate theme button and "Secure Connection" label take header space. |
| Overview | `/app` | Guest, loading, empty, funded, partial (chain or price down), error, locked, dark | Total in dollars, five groups (cash, crypto, stocks, metals, earn), unavailable values left out of the total and said so, Deposit and Send. Five separate panels; no recent activity; the empty state is a sentence and a link. |
| Deposit | `/app/deposit` | Guest, loading, empty, switched off, error, dark | Receive by address and QR, add from a connected wallet (Base or another network, with fees shown first), pay by card, bank details and deposits through Bridge. Four stacked panels on one long page; the address block is cramped. |
| Send | `/app/send` | Guest, loading, empty, switched off, dialog, invalid input, saved recipient, review, complete, unknown tag, bank form, locked, dark | To an address, saved recipient, own wallet, or Aura tag; other networks through LI.FI; bank payouts; passkey; limits and waiting periods. The page lists every asset (including zero balances) before a Send button opens the actual form in a dialog. |
| Swap | `/app/swap` | Guest, loading, switched off, asset picker, quote, error, dark | Any registered asset, both ways, other networks, slippage, quote expiry, tracked bridge delivery. |
| Earn | `/app/earn` | Guest, loading, empty, switched off, deposit form, rates unavailable, dark | Aave and two Morpho vaults with rates, liquidity, deposits, withdraw and withdraw all, live-growing positions. Every vault is a large card with its form inside. |
| Cards | `/app/cards` | Guest, coming soon (off), not verified, card, frozen, details, dispute form, dark | Apply with Bridge, create a virtual card, allowance, freeze, daily limit, card details after passkey, card activity, disputes, phone wallets. A "Not issued" card picture shows while cards are switched off. |
| Transactions | `/app/transactions` | Guest, loading, empty, list, receipt, statement, partial (transfers down), dark | History with search and filters, receipts, CSV export, monthly statement, network links. The explanation of sources sits in a mono paragraph under the list. |
| Transaction detail | `/app/transactions/[id]` | Sent | The full journey of one action, from the receipt's "Full history". |
| Insights | `/app/insights` | Guest, loading, empty, with data, table, unavailable, dark | Money in and out over time, top card merchants, periods (7D to 1Y). A separate section from Transactions for related data. |
| Settings | `/app/settings` | Guest, loading, funded, no passkey, locked, dark | Sign-in and passkey, transaction controls and lock, saved recipients, Aura tag, notifications, this device, data download, account closing. One long page of mixed sections. |
| Support | `/app/support` | Guest, loading, dark | Chat (Intercom), help articles, report a problem. |
| Not found | any unknown route | Default | |
| Design system reference | `/design-system.html` | Default | Replaced in phase 3. |
| Ops: signed out | ops `/` | Without an Access token | |
| Ops: Customers | ops `#customers` | List, one customer, lock form | Find, list, lock, close, reopen, each with a reason. |
| Ops: Money movement | ops `#movement` | Feed, action journey | Every customer's transactions, filters, journey, chain check. |
| Ops: Stats | ops `#stats` | Default | Customers, activity, new-customer funnel. |
| Ops: Controls | ops `#controls` | Default | Feature switches, asset pauses, issues. |
| Docs site | docs Worker | Home, guide, legal, not found, nav, dark | Starlight defaults with Aura colours. |
