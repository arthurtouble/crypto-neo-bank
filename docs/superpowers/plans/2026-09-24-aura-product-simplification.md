# Aura product simplification implementation plan

Date: 2026-09-24
Status: For review; implementation starts after approval
Design: [Aura product simplification](../specs/2026-09-24-aura-product-simplification-design.md)

## 1. Inventory and regression baseline

- Record current routes, feature flags, provider states, protected API contracts, and retained tables. Run typecheck, unit tests, lint, build, and existing browser checks. Save baseline failures before editing.
- Map old customer URLs to new destinations. Keep operations and security APIs reachable to authorized operators. Inventory `Aurel` strings into product copy, internal identifiers, legal text, and historical data; rename only the first class automatically.
- Commit: `docs: define Aura product boundaries` (these design artifacts and any baseline note).

## 2. Product shell and visitor browse mode

- Replace navigation in `app-shell.tsx`, section routing in `[section]/page.tsx`/`section-page.tsx`, and command links with the product map. Add simple redirects for old bookmarked routes where a clear destination exists.
- Move auth/invitation gates from the whole app to personal views and actions. Render one fixed example fixture in signed-out sections; label every example financial card, chart, and transaction, and disable action controls with a sign-in path. Keep the `/app/sandbox` operator/demo boundary separate.
- Refactor Overview to Cash, Vaults, Portfolio and recent Transactions, showing chain/provider state and explicit gaps for real users. Delete stale customer UI imports as routes disappear. Preserve all backend data and policy handlers.
- Checks: signed-out full navigation, no authenticated fetches, signed-in invitation denial, read failures, old URL redirects, desktop/mobile screenshots. Commit: `feat: simplify Aura navigation and public browse mode`.

## 3. Core money flows

- Split the current `money-workspace.tsx` into clear Deposit and Send surfaces by reusing crypto send/cross-chain and saved-recipient controls. Remove scheduling, bills, and income planning from customer pages without dropping stored instructions. Mark bank actions unavailable until active Bridge capability and execution exist.
- Keep LI.FI asset search, quote validation, cross-chain review, policy, and settlement evidence. Remove alerts/reminders and redundant market lists from the customer path. Present a distinct Invest surface with supported crypto and truthful disabled tokenized stocks/metals.
- Curate Aave Earn rows; show Sky/Morpho as unavailable only if there is specific verified product information. Make deposit/withdraw and Aave borrow/repay controls depend on existing server feature flags and action safety checks; show real debt and health from Aave reads. Do not enable a disabled write path to satisfy the UI map.
- Checks: authority labeling, stale quote, changed destination, disabled provider actions, Aave debt/repayment display. Commit after Deposit/Send; commit after Swap/Earn/Borrow/Invest.

## 4. Aura tag and public payment page

- Add additive `infra/d1/migrations/0036_aura_tags.sql` with normalized uniqueness, owner binding, public state, and timestamps. Keep tag history/audit events; do not use the tag table for balances.
- Add authenticated create/update/lookup endpoints with validation, rate limits, owner checks, and public privacy rules. Resolve tag-to-wallet immediately before transfer preparation and bind the resolved address to the reviewed intent.
- Build `/pay/[tag]` with crypto address/QR, Bridge bank instructions only when permitted and connected, and an explicit unavailable card method. No acquiring checkout until a real adapter exists. Add safe copy states and accessible errors.
- Checks: collision and race behavior, reserved tags, opt-in privacy, unknown tag response, stale address rejection, unauthenticated page, no card link or bank details without provider proof. Commit: `feat: add Aura tags and public payment page`.

## 5. Cards, Rewards, Transactions, Insights, Settings, Support

- Rename and trim card UI to the requested controls. Extend issuer contract only for capabilities actually returned by Bridge/Rain; keep all unsupported mutations disabled. Route eligible card transactions to a dispute entry only when an issuer case endpoint is connected.
- Replace membership tier projections and concierge presentation with honest Rewards and Support pages. Keep existing benefit entitlement data and support cases. Show cashback only from authoritative provider records; otherwise unavailable.
- Reuse activity evidence for Transactions with details, source, status, and coverage. Trim Insights to available spending/investment observations; never infer missing history. Consolidate security controls under Settings without deleting recovery/passkey/limit records or policy checks.
- Checks: provider-absent states, transaction provenance, retained exports and recovery controls, accessibility. Commit in coherent slices for Cards/Rewards/Transactions and Settings/Support.

## 6. Landing, assets, docs, and finish

- Redesign `app/page.tsx` and its CSS against the exact requested section order and copy. Use Aura-owned screen imagery with visibly fictional data. Adjust card radius, label scale, spacing, mobile sticky CTA safe area, and responsive layout while retaining design tokens.
- Remove `/waitlist` from public navigation and retire the public sign-up endpoint after confirming it has no required caller; retain historical entries and restricted operator access until retention review. Update customer docs, README, metadata, status/claims footnotes, and internal product references. Keep unverified legal-party names and operational identifiers.
- Run marketing claim checks, typecheck, lint, unit and e2e suites, docs build, migration/recovery checks, and desktop/mobile Playwright plus keyboard/accessibility review at 320, 768, 1024, 1440px. Fix concrete regressions, inspect final diff for unsafe feature activation and data deletion, then commit documentation and verification changes.
- Final delivery: branch name, commit list, tests and screenshots, migration instructions for later review, known unavailable integrations, and explicit note that nothing was deployed.

## Hold points

- Plan approval before implementation.
- No production migration or deployment. A migration file is reviewable code only.
- Card acquiring/payment links, bank movement, securities orders, rewards payout, Sky/Morpho actions, and any paused Aave or swap write stay unavailable until a connected provider and existing security/release gates prove them safe.
