---
title: Feature readiness
description: The feature-by-feature pass that made every customer flow work end to end before the redesign.
---

Agreed on 26 September 2026; every feature below was done or cut by 28 September 2026. Step 2 continues in [redesign](redesign.md). Update the status table in the same pull request that changes a feature.

## The plan

1. **Make the product work.** Feature by feature, in the order below, one branch and pull request each, each finished before the next. Keep the current UI; no visual design.
2. **Redesign.** Wireframes, the new design system, the new experience, and the landing page, on top of working flows.
3. **Words.** Rewrite product copy and docs to sound human, per the content style guide.
4. **Launch hardening.** Legal text, geoblocking and account gating, production setup (a separate Privy production app, error logging, alerts), SEO, a final refactor and DRY pass, and production deployment.

Geoblocking, account gating, and production setup were first planned for step 1. On 28 September 2026 the product owner moved them to step 4 so the redesign could start.

Bridge banking and the Bridge + Stripe Issuing card program are not approved yet. Their adapters are built completely, behind switches that are off, and tested against recorded or fake provider responses.

## Definition of done

- **Scope decided** with the product owner at the start. Cut or simplify anything not in the first release, and delete its code, routes, tables, and tests.
- **Server rules enforced and tested.** Feature switches, account lock, daily limits, recipient rules, and the passkey requirement are checked on the server for every money action, with a unit test for each refusal.
- **Unit tests** cover domain logic, API routes (success and each error code), and database effects, including D1 triggers where they apply.
- **End-to-end tests** (Playwright, desktop and mobile) cover every customer step: the happy path, main failures, and empty and loading states. They run signed in, against local bindings, with Privy and chain calls stubbed at the app's edge (see [`apps/web/tests/e2e/README.md`](../../apps/web/tests/e2e/README.md)).
- **Live check on dev.** Anything that moves money gets a small real transaction on dev, verified from the database and the chain: action status, events, Transactions page, and receipt.
- **Records are right.** Every financial observation shows source, reference, status, and time. Stale or failed reads show as unavailable.
- **Clean as you go.** No dead code, duplicated helpers, or unused flags in the feature's area.
- **Docs in sync**, in the same pull request: every doc in `docs/` and `apps/docs` that describes the feature says what works, what is coming soon, and what was cut. Search both for the feature's names, screens, routes, and switches. Dated files stay as they were.
- **Checks pass**: `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and `pnpm test:e2e` for the feature's specs.

## Order and status

| # | Feature | Includes | Status |
| --- | --- | --- | --- |
| 1 | Sign-in and Overview | Signed-in end-to-end test setup, email and wallet sign-in, terms acceptance, account creation, Overview balances in US dollars with a total | Done ([#18](https://github.com/arthurtouble/crypto-neo-bank/pull/18)) |
| 2 | Deposit | Receive by QR code, add from a connected wallet, deposits from other networks, card funding; bank deposits shown as coming soon | Done ([#20](https://github.com/arthurtouble/crypto-neo-bank/pull/20)) |
| 3 | Send | To an address, saved recipient, Aura tag, or own wallet; limits and cooling; passkey requirement and enrollment; destination network (Base, or another through LI.FI, fees from the amount); saving a new address as a named recipient; bank payouts shown as coming soon | Done ([#23](https://github.com/arthurtouble/crypto-neo-bank/pull/23), [#24](https://github.com/arthurtouble/crypto-neo-bank/pull/24), [#26](https://github.com/arthurtouble/crypto-neo-bank/pull/26)) |
| 4 | Swap | On Base between any registered assets, both ways; to and from other networks, including selling Tether Gold from Ethereum; slippage setting; the same sent-and-tracked handoff as Send | Done ([#29](https://github.com/arthurtouble/crypto-neo-bank/pull/29)) |
| 5 | Earn | Aave on Base (USDC, WETH) and two Morpho USDC vaults (Steakhouse, Gauntlet); positions grow live at their yearly rate; Sky cut; Syrup deferred | Done ([#30](https://github.com/arthurtouble/crypto-neo-bank/pull/30), [#31](https://github.com/arthurtouble/crypto-neo-bank/pull/31)) |
| 6 | Invest | Catalog and buying. Cut on 27 September 2026: crypto, tokenized stocks, and Tether Gold are bought in Swap, and `/app/invest` redirects there | Cut ([#33](https://github.com/arthurtouble/crypto-neo-bank/pull/33)) |
| 7 | Transactions | History, receipts, CSV export, monthly statement, Insights totals, background re-check; money received without an action (Alchemy transfer index, Base and Ethereum); completed once in a block, then final | Done ([#34](https://github.com/arthurtouble/crypto-neo-bank/pull/34), [#36](https://github.com/arthurtouble/crypto-neo-bank/pull/36)) |
| 8 | Settings and security | Limits, recipients, account lock (loosening needs the passkey), passkey, Aura tag, instant data download, account closing by an operator at zero funds (no customer deletion), notifications by email, browser push, and in the app; adding an email through Privy for wallet sign-ups; Settings trimmed to what customers use | Done ([#37](https://github.com/arthurtouble/crypto-neo-bank/pull/37), [#38](https://github.com/arthurtouble/crypto-neo-bank/pull/38), [#39](https://github.com/arthurtouble/crypto-neo-bank/pull/39)) |
| 9 | Support | Intercom Messenger with Fin (AI agent) and the team, identified by a server-signed JWT; Fin reads the latest transactions through a data connector; help articles on the docs site; report a problem (someone else using the account: lock in Settings, then chat; money sent to a scam); locking and unlocking stay in Settings. In-house support cases, feedback, and the status and incident routes cut on 28 September 2026; card disputes moved to row 10 | Done ([#40](https://github.com/arthurtouble/crypto-neo-bank/pull/40), [#41](https://github.com/arthurtouble/crypto-neo-bank/pull/41), [#42](https://github.com/arthurtouble/crypto-neo-bank/pull/42)) |
| 10 | Bank and cards | Bridge for bank; Bridge + Stripe Issuing for cards (Rain dropped). Bank ([#43](https://github.com/arthurtouble/crypto-neo-bank/pull/43)): identity verification, US account details, bank deposits as USDC, saved banks, payouts with Bridge status and notices. Cards: Bridge `cards` approval and Stripe cardholder, one virtual Visa card per account, spending allowance (USDC `approve` on Base to Bridge's card contract, pulled per purchase), freeze, daily limit (passkey step-up to unfreeze or raise), card details in Stripe's frames after passkey step-up, card activity, disputes, Apple and Google Pay behind `card_wallets`. Card payments, holds, declines, and refunds in Transactions, statements, and Insights. Built and tested against local fakes; the live check waits on a Bridge card program and a Stripe account | Done ([#43](https://github.com/arthurtouble/crypto-neo-bank/pull/43), [#44](https://github.com/arthurtouble/crypto-neo-bank/pull/44)); live check pending |
| 11 | Rewards and Insights | Rewards cut (no provider reports memberships or benefits). Insights kept, with top card merchants and money in and out over time | Done ([#45](https://github.com/arthurtouble/crypto-neo-bank/pull/45)) |
| 12 | Operations console | A separate operator app (`apps/ops`, its own Worker behind Cloudflare Access; the web app verifies the Access token on every operator API; Privy sessions never count): customers (look up by Privy ID, email, wallet, or Aura tag; profile, holdings, Intercom user ID; lock, close at zero, reopen, each with a reason), money movement with each action's journey and a chain check, stats and the new-customer funnel, feature switches, asset pauses, and issues. Replaces the console in the customer app; support happens in Intercom | Done ([#46](https://github.com/arthurtouble/crypto-neo-bank/pull/46)) |

Status values: Not started, In progress, Done (with the pull request link), Cut.
