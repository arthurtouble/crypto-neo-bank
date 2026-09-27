---
title: Screen data
description: The API each screen reads, and how guests see the same screens with example data.
---

Screens get their data from hooks in `apps/web/src/lib/client/queries.ts`. Each hook returns `{ data, isExample, isPending, error }`:

- Signed in, `data` comes from the API.
- Signed out, `data` is the matching fixture in `apps/web/src/lib/example/data.ts`, in exactly the API's shape, and `isExample` is true. The screen must show the example label. Layout never branches on sign-in state.

Fixtures use obviously fictional addresses (`0x000…e0a1`) and no transaction hashes; `tests/unit/example-data.test.ts` checks that, and that totals add up.

Money movements use `useAction` (`lib/client/use-action.ts`): `run(input)` for `POST /api/actions`, or `runPrepared(prepare)` for endpoints that prepare an action themselves, such as bank payouts. Show progress with `TransactionProgress`.

## Endpoints by screen

| Screen | Reads | Writes |
| --- | --- | --- |
| Overview | `GET /api/overview`: cash (USDC), crypto (ETH, WETH, cbBTC on Base), and earn (Aave aTokens and Morpho vault shares valued in USDC, on Base; source `morpho:base`, shown as Morpho on Base) holdings, each with `source`, `status` (`observed` or `unavailable`), `usdCents`, and `observedAt`; totals per group and overall (`all`) with a `partial` flag when a balance or price is unavailable | |
| Deposit | The account address (from Privy); the connected wallet's balance on the chosen network (read in the browser); `GET /api/money/account` (bank state and next step) | `POST /api/deposits/quote`, `GET /api/deposits/status`, `POST /api/money/onboarding`; card funding opens Privy's `useFundWallet` in the browser (no Aura API) |
| Send | `GET /api/recipients`, `GET /api/aura-tags/:tag` | `POST /api/actions` (`transfer`), `POST /api/money/bank-accounts`, `POST /api/money/payouts` |
| Swap, Invest, cross-chain | `GET /api/swap/assets`, `GET /api/invest/catalog` (public), `GET /api/routes/quote` | `POST /api/actions` (`route`) |
| Earn | `GET /api/defi/aave/markets?address=` (Aave rates from Aave's data service and the account's positions); `GET /api/defi/morpho/vaults` (public: the reviewed vaults, each with net APY, total deposits, and withdrawable liquidity from Morpho's public GraphQL API, or `rate: null` when that read fails); Morpho positions come from `GET /api/overview` | `POST /api/actions` (`earn`) |
| Transactions | `GET /api/actions`, `GET /api/actions/:id` (with `events`), `GET /api/activity` (adds Aave history) | |
| Statements | `GET /api/statements?month=YYYY-MM` (CSV) | |
| Insights | `GET /api/insights?days=30` | |
| Cards, Rewards | `GET /api/cards`, `GET /api/rewards` (both empty until the card program is on) | |
| Settings | `GET /api/security/policy`, `GET /api/security/addresses`, `GET /api/preferences`, `GET /api/privacy/consent` | `PATCH /api/security/policy`, address book, preferences, data requests |
| Support | `GET /api/support/cases` | `POST /api/support/cases` |

Every financial value keeps its source and observation time to the screen. A holding with `status: "unavailable"` shows as unavailable, never as zero or a previous value.

## Routes

`/app/[section]` renders each section. Static folders take precedence, so sections can grow sub-routes one at a time; `/app/transactions/[id]` is the first. Old section names redirect through `lib/product-map.ts`.
