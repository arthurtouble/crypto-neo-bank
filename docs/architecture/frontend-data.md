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
| Overview | `GET /api/overview`: cash (USDC), crypto (ETH, WETH, cbBTC on Base), and earn (Aave aTokens and Morpho vault shares valued in USDC, on Base; source `morpho:base`, shown as Morpho on Base) holdings, earn holdings with `apyPct` when the rate can be read (Aave: `currentLiquidityRate` from the same `getReserveData` read, compounded to an APY; Morpho: the vault's net APY from Morpho's API, read once and only when the account holds a vault). The page grows an earn position from `observedAt` at `apyPct` (`components/live-amount.tsx`), shown to 8 decimals; this is display only, and every refetch replaces it with the chain's value. Other holdings, each with `source`, `status` (`observed` or `unavailable`), `usdCents`, and `observedAt`; totals per group and overall (`all`) with a `partial` flag when a balance or price is unavailable | |
| Deposit | The account address (from Privy); the connected wallet's balance on the chosen network (read in the browser); `GET /api/money/account` (bank state and next step) | `POST /api/deposits/quote`, `GET /api/deposits/status`, `POST /api/money/onboarding`; card funding opens Privy's `useFundWallet` in the browser (no Aura API) |
| Send | `GET /api/recipients`, `GET /api/aura-tags/:tag` | `POST /api/actions` (`transfer`), `POST /api/money/bank-accounts`, `POST /api/money/payouts` |
| Swap, cross-chain | `GET /api/swap/assets`, `GET /api/routes/quote` (`/app/swap?to=<assetId>` opens Swap on an asset) | `POST /api/actions` (`route`) |
| Earn | `GET /api/defi/aave/markets?address=` (Aave rates from Aave's data service and the account's positions); `GET /api/defi/morpho/vaults` (public: the reviewed vaults, each with net APY, total deposits, and withdrawable liquidity from Morpho's public GraphQL API, or `rate: null` when that read fails); Morpho positions come from `GET /api/overview` | `POST /api/actions` (`earn`) |
| Transactions | `GET /api/activity`: the customer's own account only (the wallet comes from Privy, never the request), as `entries` (`lib/activity/entries.ts`) from three sources, each with `status` and `partial` in `sources`: Aura actions (latest 100, a few open ones re-checked on read), money received without an action (`lib/activity/incoming.ts`, below), and Aave history. `GET /api/actions/:id` (with `events`) for a receipt's journey and the detail page | |
| Statements | `GET /api/statements?month=YYYY-MM`: CSV of the month's actions (not expired) and money received, in the same columns as the list export. `503 statement_incomplete` when received money can't all be read, never a short statement | |
| Insights | `GET /api/insights?days=7\|30\|90\|365`: totals from completed entries in the period; `incomingComplete: false` when received money can't all be read, and the page shows money in as unavailable | |

**Money received.** `lib/activity/incoming.ts` calls Alchemy's `alchemy_getAssetTransfers` (external and ERC-20, to the account, newest first) on the configured `RPC_URL_8453` and `RPC_URL_1` when they are Alchemy URLs, and reads the finalized block from the same node. A transfer is listed only if it is a registered asset with the `hold` use on that network, from another address, and not one of the account's own action transactions (`listActionHashes`: source and destination hashes). It is `completed` once indexed (in a block), with `final` true at or below the finalized block. Without an Alchemy node, or when a read fails, the source is `unavailable`; with more pages than read, `partial`. Nothing is stored in D1. Values use today's price (`valueAsset` per unit, once per asset per request). Alchemy's index doesn't list internal (contract-originated) ETH transfers on Base.
| Cards, Rewards | `GET /api/cards`, `GET /api/rewards` (both empty until the card program is on) | |
| Settings | `GET /api/security/policy`, `GET /api/security/addresses`, `GET /api/aura-tags`, `GET /api/preferences`, `GET /api/privacy/consent`, `GET /api/privacy/export` (JSON download) | `PATCH /api/security/policy` (a `428 confirmation_required` answer is signed with the passkey and sent again with `confirmation`), address book, Aura tag, preferences, consent. A `403 account_closed` from any route makes the app show the closed-account notice (`components/account-closed.tsx`) on every page but Support |
| Operations: accounts | `GET /api/ops/accounts?q=` (email, wallet, or Privy user ID; returns whether the account can be closed and why not) | `POST /api/ops/accounts/:subject/close` and `/reopen` with a reason |
| Support | `GET /api/support/cases` | `POST /api/support/cases` |

Every financial value keeps its source and observation time to the screen. A holding with `status: "unavailable"` shows as unavailable, never as zero or a previous value.

## Routes

`/app/[section]` renders each section. Static folders take precedence, so sections can grow sub-routes one at a time; `/app/transactions/[id]` is the first. Old section names redirect through `lib/product-map.ts`.
