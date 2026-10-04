---
title: Feature readiness
description: The closed feature-by-feature plan: the four launch steps, the definition of done, and the pull requests for each feature.
---

Agreed on 26 September 2026 and closed. What each feature does now is in [build status](build-status.md); this file keeps the plan, the definition of done that still applies to any feature change, and where each feature was built.

## The four steps

1. **Make the product work**, feature by feature (below). Done by 28 September 2026.
2. **Redesign** on top of working flows. Done 30 September 2026 ([redesign](redesign.md)).
3. **Words**: product copy and docs per the [content style guide](../product/content-style-guide.md). Done 30 September 2026 ([#75](https://github.com/arthurtouble/crypto-neo-bank/pull/75), [#76](https://github.com/arthurtouble/crypto-neo-bank/pull/76), trimmed in [#82](https://github.com/arthurtouble/crypto-neo-bank/pull/82)–[#84](https://github.com/arthurtouble/crypto-neo-bank/pull/84)).
4. **Launch hardening**: legal text (#76), sanctioned places blocked ([#77](https://github.com/arthurtouble/crypto-neo-bank/pull/77)), logging and alerts ([#78](https://github.com/arthurtouble/crypto-neo-bank/pull/78)), production prepared ([#79](https://github.com/arthurtouble/crypto-neo-bank/pull/79)), SEO ([#80](https://github.com/arthurtouble/crypto-neo-bank/pull/80)), and a refactor pass. Done 30 September 2026 except the production deployment, which waits for the owner ([production launch](../operations/production-launch.md)). Account gating is the server-side controls in [launch controls](../operations/launch-controls.md).

## Definition of done

- **Scope decided** with the product owner at the start. Anything not in the first release is cut, with its code, routes, tables, and tests.
- **Server rules enforced and tested.** Feature switches, account lock, daily limits, recipient rules, and the passkey requirement are checked on the server for every money action, with a unit test for each refusal.
- **Unit tests** cover domain logic, API routes (success and each error code), and database effects.
- **End-to-end tests** (Playwright, desktop and mobile) cover every customer step: the happy path, main failures, and empty and loading states, signed in, against local bindings, with Privy and chain calls stubbed at the app's edge ([`apps/web/tests/e2e/README.md`](../../apps/web/tests/e2e/README.md)).
- **Live check on dev.** Anything that moves money gets a small real transaction on dev, verified from the database and the chain.
- **Records are right.** Every financial observation shows source, reference, status, and time. Stale or failed reads show as unavailable.
- **Clean as you go.** No dead code, duplicated helpers, or unused flags in the feature's area.
- **Docs in sync** in the same pull request, in `docs/` and `apps/docs`. Dated files stay as they were.
- **Checks pass**: `pnpm lint`, `pnpm typecheck:all`, `pnpm test:unit`, and the feature's e2e specs.

## Features and pull requests

| # | Feature | Result |
| --- | --- | --- |
| 1 | Sign-in and Overview | Done ([#18](https://github.com/arthurtouble/crypto-neo-bank/pull/18)) |
| 2 | Deposit | Done ([#20](https://github.com/arthurtouble/crypto-neo-bank/pull/20)) |
| 3 | Send | Done ([#23](https://github.com/arthurtouble/crypto-neo-bank/pull/23), [#24](https://github.com/arthurtouble/crypto-neo-bank/pull/24), [#26](https://github.com/arthurtouble/crypto-neo-bank/pull/26)) |
| 4 | Swap | Done ([#29](https://github.com/arthurtouble/crypto-neo-bank/pull/29)) |
| 5 | Earn | Done ([#30](https://github.com/arthurtouble/crypto-neo-bank/pull/30), [#31](https://github.com/arthurtouble/crypto-neo-bank/pull/31)); Sky cut, Syrup deferred |
| 6 | Invest | Cut on 27 September 2026 ([#33](https://github.com/arthurtouble/crypto-neo-bank/pull/33)); stocks and gold are bought in Swap |
| 7 | Transactions | Done ([#34](https://github.com/arthurtouble/crypto-neo-bank/pull/34), [#36](https://github.com/arthurtouble/crypto-neo-bank/pull/36)) |
| 8 | Settings and security | Done ([#37](https://github.com/arthurtouble/crypto-neo-bank/pull/37), [#38](https://github.com/arthurtouble/crypto-neo-bank/pull/38), [#39](https://github.com/arthurtouble/crypto-neo-bank/pull/39)) |
| 9 | Support | Done ([#40](https://github.com/arthurtouble/crypto-neo-bank/pull/40), [#41](https://github.com/arthurtouble/crypto-neo-bank/pull/41), [#42](https://github.com/arthurtouble/crypto-neo-bank/pull/42)) |
| 10 | Bank and cards | Done ([#43](https://github.com/arthurtouble/crypto-neo-bank/pull/43), [#44](https://github.com/arthurtouble/crypto-neo-bank/pull/44)); live check waits on a Bridge card program and a Stripe account |
| 11 | Rewards and Insights | Done ([#45](https://github.com/arthurtouble/crypto-neo-bank/pull/45)); Rewards cut; since 4 October 2026 Insights is the summary at the top of Transactions |
| 12 | Operations console | Done ([#46](https://github.com/arthurtouble/crypto-neo-bank/pull/46)) |
