---
title: Redesign direction
description: Phase 3 of the redesign. The owner's brief, answers to the open questions, references, and three early visual directions, parked until the journeys are locked.
---

Phase 3 of [the redesign](../overview/redesign.md), started on 28 September 2026. **Parked**: on 29 September the owner asked to lock the product skeleton first (journeys, navigation, placement, and flows, in [redesign-journeys.md](redesign-journeys.md)), then decide colour, type, and style. This document picks up after that. Phase 4 then writes the new design system from it.

## Brief

From the product owner, 28 September 2026:

- **Don't build on today's design.** Today's screens are a map of what Aura does, nothing more. The new interface is a clean break: new layout, type, colour, and components.
- **Extremely professional, easy to use, streamlined, and fast.**
- **Desktop and mobile are designed separately.** They share one theme (colour, type, icons, tone) but each has its own navigation, components, and flows, built for how it's used: a pointer, a keyboard, and a wide screen on desktop; one thumb and a small screen on a phone.

This replaces the character in the current [design system](design-system.md) ("calm, exact, discreet"). The quality rules in that document still hold (no decoration without information, literal statuses, unavailable data never shown as a number, every state designed), because they are about honesty and clarity, not about the old look.

## What doesn't change

The redesign rules in [redesign.md](../overview/redesign.md) stand. Flows, API contracts, D1, feature switches, and money rules stay as they are. Every route keeps working, so links and e2e specs keep their meaning. Copy stays until step 3, except labels a layout forces to move.

## Answers to the open questions

The owner hasn't answered these yet. Each has a proposed answer, marked as proposed, so later phases aren't blocked. Correct any of them before picking a direction.

| Question | Answer |
| --- | --- |
| Apps in scope | Proposed: the customer app first, then the landing page and `/pay/[tag]`, then the docs site's look. Owner, 29 September: the ops console gets the new look only, with no layout redesign. |
| Products liked, and why | Proposed, from the brief: Linear (speed, keyboard, restraint), Mercury (calm, exact tables), Stripe Dashboard (actions in drawers, clear hierarchy), Revolut and Wise (fast money actions on a phone). |
| Three words | Owner: professional, streamlined, fast. |
| What to keep from today | Owner: nothing visual. Keep the behavior: labeled example data, review before every money action, literal statuses, unavailable instead of stale. |
| Mobile first? Native app? | Proposed: mobile and desktop equally, with every flow finishable one-handed on a phone. No native app planned yet; phone layouts use patterns that carry over (bottom tabs, sheets). |
| Wireframes or high fidelity | Proposed: high fidelity in code. The directions below are already quick high-fidelity mockups. |
| Where design happens | Proposed: in code. The design system reference page (`apps/web/public/design-system.html`) is the source of truth, reviewed in pull requests with screenshots. |
| Brand assets | Proposed: a new wordmark and app icon are needed for the new look; no illustrations. Asset and provider logos come from their owners. Until then, a text wordmark. |
| Primary navigation | Owner, 29 September: ten sections, not grouped. A sidebar on desktop; on the phone, a floating menu button that opens a sheet of ten tiles. See [redesign-journeys.md](redesign-journeys.md#navigation). |

## Structure, navigation, and desktop and mobile

Moved to [redesign-journeys.md](redesign-journeys.md), phase 2: the navigation, the shared patterns (including what "fast" means), and every journey on desktop and phone.

## References from the owner's notes

Checked on 28 September 2026. The three X posts (codestirring, neropursue, voxyz_ai) are lists of AI design tools; the ones worth using are below. Coinbase's help centre and Mobbin blocked automated reading, so the Coinbase notes come from search results and need a check by hand.

| Source | What it is | How we use it |
| --- | --- | --- |
| [DESIGN.md](https://github.com/google-labs-code/design.md) (Google Stitch, Apache-2.0) | A file format for a design system: tokens in YAML front matter, then Overview, Colors, Typography, Layout, Elevation, Shapes, Components, Do's and Don'ts. Its CLI lints (including contrast), diffs, and exports tokens. | Phase 3 writes Aura's system as a root `DESIGN.md` that coding agents read, imported from `CLAUDE.md`, next to `design-system.md` and the reference page. Outside references only fill what it doesn't decide. |
| [component.gallery](https://component.gallery) | 60 components compared across 95 design systems. | Names and specs for our components: segmented control, drawer, sheet, combobox, toast, empty state. |
| [Refero Styles](https://styles.refero.design) | DESIGN.md write-ups of 2,000+ real products, including Mercury, Wise, Ramp, and Brex. | Benchmarks for density, type scale, and number setting. Not themes to copy. |
| [Impeccable](https://impeccable.style) | Open-source design commands for coding agents (audit, distill, quieter, adapt, document) and a list of 61 anti-patterns. | Its anti-pattern list joins our review checklist. Installing its plugin needs the owner's approval. |
| [21st.dev](https://21st.dev) | A registry of React, Tailwind, and shadcn components; free copies are capped daily. | Reference for hard interactions (keypad amount entry, bottom sheets, OTP input). Structure and accessibility only, never its styling. |
| Coinbase Wallet (the Base app) | Mobile crypto flows. | Receive: asset, then network, then QR, with a wrong-network warning. Send: amount first; saved recipients and own wallets go straight to review; a first-time address gets a check step (address in chunks, network, a small test-send hint). Swap review lists output, slippage, and each fee. |

The first-time-address check step would add a screen to Send. It changes no server rule, but it is a flow change, so it needs the owner's yes before phase 4.

## Three early directions

Parked until the journeys are locked. They were drawn before the skeleton, so their layouts will follow the journeys rather than the other way round.


The mockups are in [`redesign-directions.html`](redesign-directions.html): Overview and Send in each, desktop and phone, light and dark, with the same fictional example data.

1. **A · Console.** Light and exact. White and cool grey, one blue for actions, an icon rail, one holdings table, and every money action in a drawer. Closest to Linear and Stripe.
2. **B · Instrument.** Dark first and dense. A top bar with every section, tables with column headers, source and time on every figure. Closest to Linear's dark theme and pro trading tools, without the charts.
3. **C · Pocket.** Phone first. One big balance on a colour block, four quick actions, people and assets as avatars, amount entry large and centred. Closest to Revolut and Cash App.

**Recommendation: A · Console**, with C's amount-first entry and avatar recipients inside its Move money drawer on phones. It's the most professional of the three, it scales to the densest screens (Activity, Cards controls), and its drawer is the biggest single cut to steps. B risks reading as a trading terminal; C is the strongest on a phone but the hardest to keep sober on desktop.

## Next

1. The owner locks the journeys and wireframes (phase 2).
2. Then picks a look and corrects the proposed answers (this phase).
3. Phase 4 writes the new system from it: a root `DESIGN.md` for agents, `design-system.md` for people, and the `design-system.html` reference page. Shared tokens, then desktop and mobile components and patterns, in light and dark.
