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
- **The design system comes first.** [`docs/product/design-system.md`](../product/design-system.md) and the reference page `apps/web/public/design-system.html` are rewritten in phase 2, and screens are built from them. Don't make one-off styles in a screen.

## Phases

1. **Inventory.** Every page, dialog, and state (loading, empty, error, disabled, signed out), on desktop and mobile, with screenshots from dev or the e2e fake. The result is the screen list below, filled in, and a short note of what's wrong today.
2. **Direction.** The product owner answers the open questions below. The result is a one-page direction: character, references, what to keep, what to drop.
3. **Design system.** Tokens (color, type, spacing, radius, elevation, motion), components, and patterns (money amounts, statuses, confirmations, lists, empty and error states), in light and dark. It replaces the current design-system doc and reference page, and ships as its own pull request before any screen.
4. **Screens.** Area by area, in the order of the status table.
5. **Landing and public pages.** The landing page, the Aura tag pay page, the waitlist, and the docs site's look.

## Open questions for the product owner

To answer in phase 2, before any design work.

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
- Screenshots of the area (desktop and mobile, light and dark) attached to the pull request.
- Docs that show or describe the screens (`docs/` and `apps/docs`) updated.
- `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and the area's e2e specs pass.

## Order and status

| # | Area | Includes | Status |
| --- | --- | --- | --- |
| 1 | Inventory | Every screen and state, with screenshots and what's wrong today | Not started |
| 2 | Direction | Answers to the open questions; a one-page direction | Not started |
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

Filled in during phase 1. Customer app sections today (`apps/web/src/lib/product-map.ts`): Overview, Deposit, Send, Swap, Earn, Cards, Transactions, Insights, Settings, Support. Other pages: the landing page, `/pay/[tag]`, `/waitlist`, and a transaction detail page. The ops console has Customers, Money movement, Stats, and Controls.

| Screen or dialog | Route | States seen | Notes |
| --- | --- | --- | --- |
