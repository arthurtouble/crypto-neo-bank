---
title: Redesign
description: The rules for Aura's redesign (step 2), which is done.
---

Step 2 of four, after [feature readiness](feature-readiness.md). Done on 30 September 2026: every area was rebuilt on the new design system in [#54](https://github.com/arthurtouble/crypto-neo-bank/pull/54)–[#68](https://github.com/arthurtouble/crypto-neo-bank/pull/68). The phase plan, status table, and screen inventory are in this file's git history.

## Rules that still apply to screen work

- **Flows stay as they are.** A layout change never changes server logic, API contracts, D1, feature switches, or money rules. A needed behavior change goes to the product owner as its own pull request.
- **Tests keep passing.** Update selectors when markup changes, never the behavior a test checks. Don't delete a test to get green.
- **Guest pages keep their labeled example data.**
- **Design system only.** Screens are built from [`docs/product/design-system.md`](../product/design-system.md), `DESIGN.md`, and `apps/web/public/design-tokens.css`, rendered at `apps/web/public/design-system.html`. No one-off styles.
- **Every state designed:** loading, empty, error, unavailable data, disabled, and narrow screens, desktop and mobile, light and dark.
- **Accessible:** keyboard use, focus, labels, contrast, reduced motion.

The journeys and wireframes are in [redesign-journeys.md](../product/redesign-journeys.md) and [redesign-wireframes.html](../product/redesign-wireframes.html); the visual direction is in [redesign-direction.md](../product/redesign-direction.md) and [redesign-visual.html](../product/redesign-visual.html). `apps/web/tests/inventory/inventory.spec.ts` screenshots every screen and state (`pnpm --filter @aurel/web exec playwright test -c playwright.inventory.config.ts`).
