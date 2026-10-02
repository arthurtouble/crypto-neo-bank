---
title: Screen data
description: The API each screen reads, and how guests see the same screens with example data.
---

Screens read data through hooks in `apps/web/src/lib/client/queries.ts`. Each returns `{ data, isExample, isPending, error }`:

- Signed in, `data` comes from the API.
- Signed out, `data` is the matching fixture in `apps/web/src/lib/example/data.ts`, in exactly the API's shape, and `isExample` is true. The screen must show the example label. Layout never branches on sign-in state.

Fixtures use obviously fictional addresses (`0x000…e0a1`) and no transaction hashes; `tests/unit/example-data.test.ts` checks that, and that totals add up.

Money movements use `useAction` (`lib/client/use-action.ts`): `run(input)` for `POST /api/actions`, or `runPrepared(prepare)` for endpoints that prepare an action themselves, such as bank payouts. Show progress with `TransactionProgress`.

Every financial value keeps its source and observation time to the screen. A holding with `status: "unavailable"` shows as unavailable, never as zero or a previous value.

## Endpoints by screen

| Screen | Reads | Writes |
| --- | --- | --- |
| Overview | `GET /api/overview`: cash (USDC), crypto (ETH, WETH, cbBTC on Base), and earn holdings (Aave aTokens and Morpho vault shares valued in USDC, on Base; source `morpho:base`, shown as Morpho on Base), with `apyPct` when the rate can be read (Aave: `currentLiquidityRate` from the same `getReserveData` read, compounded to an APY; Morpho: the vault's net APY from Morpho's API, read once and only when the account holds a vault). Overview shows each earn position in dollars as last read, with its rate; the Earn page shows the same. Other holdings, each with `source`, `status` (`observed` or `unavailable`), `usdCents`, and `observedAt`. Totals per group and overall (`all`) with a `partial` flag when a balance or price is unavailable. When no balance can be read at all, the route answers `503 overview_unavailable` instead of a $0.00 total. A crypto price is live, so it carries the overview's own `observedAt` and no `priceObservedAt`; only feeds that pause (stocks, gold, the euro) set it | |
| Deposit | The account address (from Privy); the connected wallet's balance on the chosen network (read in the browser); `GET /api/money/account` (bank state and next step) | `POST /api/deposits/quote`, `GET /api/deposits/status`, `POST /api/money/onboarding`; card funding opens Privy's `useFundWallet` in the browser (no Aura API) |
| Send | `GET /api/recipients`, `GET /api/aura-tags/:tag` | `POST /api/actions` (`transfer`), `POST /api/money/bank-accounts`, `POST /api/money/payouts` (prepares the USDC funding action to Bridge's deposit address; the toast and progress say "sent", not "complete") |
| Payment page (`/pay/:tag`, public) | Rendered on the server from `lookupPublicTag` (`lib/aura-tag-public.ts`), the same lookup as `GET /api/aura-tags/:tag`: 60 lookups a minute per visitor, keyed by the address Cloudflare saw (`cf-connecting-ip`), on the page as on the API. Every failure, including the limit, shows the page as unavailable | None |
| Swap, cross-chain | `GET /api/swap/assets`, `GET /api/routes/quote` (`/app/swap?to=<assetId>` opens Swap on an asset) | `POST /api/actions` (`route`) |
| Earn | `GET /api/defi/aave/markets` (public: Aave's USDC and WETH rates, deposits, and withdrawable liquidity from Aave's data service; no account address is sent); `GET /api/defi/morpho/vaults` (public: the reviewed vaults, each with net APY, total deposits, and withdrawable liquidity from Morpho's public GraphQL API, or `rate: null` when that read fails); Morpho positions come from `GET /api/overview` | `POST /api/actions` (`earn`) |
| Transactions | `GET /api/activity`: the customer's own account only (wallet from Privy, never the request), as `entries` (`lib/activity/entries.ts`) from four sources, each with `status` and `partial` in `sources`: Aura actions (latest 100, a few open ones re-checked on read), [money received](#money-received) without an action, [card payments](#card-activity), and Aave history. `GET /api/actions/:id` (with `events`) for a receipt's journey and the detail page | |
| Statements | `GET /api/statements?month=YYYY-MM`: CSV of the month's actions (not expired), money received, and card payments, in the list export's columns. `503 statement_incomplete` when received money or card payments can't all be read, never a short statement | |
| Insights | `GET /api/insights?days=7\|30\|90\|365`: totals from completed entries in the period. `incomingComplete: false` when received money or card payments can't all be read (money in shows as unavailable); `outgoingComplete: false` when card payments can't all be read (money out shows as unavailable). `over` is `{ unit, buckets: [{ start, incoming, outgoing }] }` for the money in and out chart: per day for 7 days, per week from Monday for 30 and 90, per month for 365, all UTC; the chart leaves out an incomplete side and says so. `topMerchants` is `[{ name, total, payments }]`: the five card merchants paid most, from settled card payments only (declines and refunds left out). Built in `lib/insights/presentation.ts` | |
| Cards | `GET /api/cards`: the card state (`unavailable` when `payment_cards` is off or Stripe, Bridge, or `BRIDGE_CARDS_SPENDER` isn't configured, then `verify_first`, `apply` with Bridge's outstanding issues, `ready_to_create`, or `card`), with the card and its activity read from Stripe and the allowance and USDC balance read from Base (`Unavailable` when Base can't be read, never zero) | `POST /api/cards/apply` (a short-lived Bridge link, never stored), `POST /api/cards` (create; needs a passkey on the account and an unlocked account), `PATCH /api/cards/controls` (`frozen`, `dailyLimitUsd`; unfreezing and raising answer `428 confirmation_required` like Settings, and unfreezing is refused while the account is locked), `POST /api/cards/details-key` (`nonce` plus a passkey `confirmation`; returns a 15-minute Stripe ephemeral key for Issuing Elements), `POST /api/cards/allowance` (`amountUsd`, returns a prepared `transfer` action; `0` turns card spending off), `POST /api/cards/disputes` (`transactionId`, `reason`, `explanation`). Card payments also show in Transactions |
| Settings | `GET /api/security/policy`, `GET /api/security/addresses`, `GET /api/aura-tags`, `GET /api/preferences`, `GET /api/privacy/consent`, `GET /api/privacy/export` (JSON download), `GET /api/notifications/push` (the VAPID public key) | `PATCH /api/security/policy` (a `428 confirmation_required` answer is signed with the passkey and resent with `confirmation`), address book, Aura tag, preferences, consent. The email is added or changed in Privy's one-time-code flow (`useLinkAccount().linkEmail`, `useUpdateEmail` from `@privy-io/react-auth/ui`); Aura keeps no copy and reads it from Privy when sending an email (`lib/notifications/deliver.ts`). Browser notifications are per browser: turning them on sends every notice there |
| Support | `GET /api/support/messenger` (Intercom app ID and a one-hour identity JWT signed with `INTERCOM_IDENTITY_SECRET`; `appId: null` when chat is off), refreshed every 50 minutes by `components/support-chat.tsx`. Intercom's Fin reads `GET /api/support/fin/activity?user_id=` server to server with `FIN_CONNECTOR_TOKEN` (latest 10 entries, `incomplete` when a source couldn't be read) | Report a problem opens the Messenger with a prefilled message; locking and unlocking are only in Settings (`#emergency-lock`) |
| Notifications (header bell) | `GET /api/notifications` every 30 seconds and on tab focus: the latest 30 notices and the unread count. Each call also checks the account for money received, at most every 30 seconds | `POST /api/notifications/read` when the list opens; `PUT`/`DELETE /api/notifications/push` to turn browser notifications on or off (up to 10 browsers per customer; a `409 subscription_in_use` means the browser's subscription belongs to another account, so the app unsubscribes it and subscribes again) |

A `403 account_closed` from any route makes the app show the closed-account notice (`components/account-closed.tsx`) on every page but Support. A `403 terms_required` (new terms since the page loaded) makes `TermsGate` check `/api/terms` again, which shows the terms; accepting them refetches everything the app had asked for.

### Bank activity

With `fiat_accounts` on and an active Bridge customer, `lib/money/bank-activity.ts` reads the USD account's `payment_processed` history (`GET /v0/customers/:id/virtual_accounts/:va/history`), so incoming USDC delivered by Bridge shows as `bank_deposit` from the sender. A bank payout is a `bank_payout` entry:

- Pending until Bridge's latest state is `payment_processed`; failed for a return, refund, or other exception, with `bankStatus` in words.
- The state comes from Bridge's webhook or a read of `GET /v0/transfers/:id`, recorded once per state as a `bank_payout` action event.
- Transactions reads refresh up to 3 open payouts; the cron refreshes up to 20.

### Card activity

`readCardHistory` (`lib/cards/service.ts`) reads every card the customer has had from Stripe: authorizations and transactions, 100 per card, or a statement's window with `created[gte]`/`created[lt]`. Disputes are read once per call for all the cards (from the window's start), and each shows only on its own card's transaction.

- Each becomes a `card_payment` or `card_refund` entry (`origin: "card"`, source Stripe, amount in USD, merchant as counterparty). A pending hold is pending, a settled payment or refund is completed, and a decline or released hold is failed with no value.
- The entry links the Base transaction in which Bridge took the USDC when Stripe reports it (`crypto_transactions[].crypto_transaction_confirmed.transaction_hash`), and carries the dispute status.
- Bridge's USDC pull is an outgoing transfer, which the incoming reader never lists, so a purchase shows once.
- A customer with a card whose history can't be read (Stripe down, or `payment_cards` off) gets `sources.card.status: "unavailable"`, never an empty list.
- The Card filter holds card payments, refunds, and allowance changes.

### Money received

`lib/activity/incoming.ts` calls Alchemy's `alchemy_getAssetTransfers` (external and ERC-20, to the account, newest first) on `RPC_URL_8453` and `RPC_URL_1` when they are Alchemy URLs, and reads the finalized block from the same node.

- A transfer is listed only if it is a registered asset with the `hold` use on that network, from another address, and not one of the account's own action transactions (`listActionHashes`: source and destination hashes).
- It is `completed` once in a block, with `final` true at or below the finalized block.
- Without an Alchemy node, or when a read fails, the source is `unavailable`; with more pages than read, `partial`.
- Nothing is stored in D1. Values use today's price (`valueAsset` per unit, once per asset per request).
- Alchemy's index doesn't list internal (contract-originated) ETH transfers on Base.

## Operations app

The operations app (`apps/ops`) is not a customer screen and has no example data. Its Worker forwards `/api/<path>` to the web app's `/api/ops/<path>`, and every route checks the operator's Cloudflare Access token (`requireOperator`, see [architecture](architecture.md#operations-app)). Every change records the operator's email; the table says which need a reason.

| Section | Reads | Writes |
| --- | --- | --- |
| Signed-in operator | `GET /api/ops/me`: the operator's email | |
| Customers | `GET /api/ops/customers?after=`: every customer, newest sign-up first, 50 a page (cursor of sign-up time and ID, so ties are never skipped or repeated), with status, lock, Aura tag, Bridge and card status, transaction count, and last activity. `GET /api/ops/accounts?q=` (Privy user ID, email, wallet address, or Aura tag): `account`, the closure check with holdings read from the chain and why it can't be closed yet; and `profile`: joined date, closed state, controls (lock, daily limit, saved recipients only), Aura tag, Bridge status, card, action counts, and the Intercom user ID | `POST /api/ops/accounts/:subject/lock` with a reason (stops sending at once, tries to freeze the card, tells the customer by email and in the app; only the customer unlocks, in Settings with their passkey; `409 already_locked`), `POST /api/ops/accounts/:subject/close` (only when empty and nothing is on its way) and `/reopen` (it stays locked), each with a reason |
| Money movement | One customer: `GET /api/ops/customers/:subject/history`, everything as they see it in Transactions (`readHistory`: Aura actions, money received from outside Aura read from the chain, card payments, Aave history), with each source's status. Everyone: `GET /api/ops/movement?status&kind&subject&stuck=1&before` (`lib/ops/movement.ts`), merged newest first, 50 at a time (`before` loads more): Aura actions; money received from outside Aura (`incoming_observations`, recorded by the incoming scan every 2 minutes and by each Transactions read); card payments (`card_observations`, recorded from Stripe's `issuing_authorization.created` and `issuing_transaction.created` webhooks and by each card history read; a settled transaction replaces its hold). `kind=received` shows only received money, `kind=card` only card payments; status, other kinds, and stuck show only Aura actions. Stuck means submitted over 15 minutes with no receipt, or settling over 2 hours. `GET /api/ops/actions/:id`: the action's journey (what, status, bank state, customer, value when prepared, timestamps, every recorded event, links to the transaction and delivery) | `POST /api/ops/actions/:id/check`: check an open action against the chain now, as the customer's screen and the cron do (audited) |
| Stats | `GET /api/ops/stats?days=7\|30\|90`: customers (total, new, closed); completed, failed, and stuck actions; volume by kind at the US dollar value recorded when prepared; the new-customer funnel (signed up, moved money, verified with Bridge, got a card); and a by-day table (sign-ups, active = opened the app, completed, volume). From D1 only: money that arrived without an Aura action isn't counted | |
| Controls | `GET /api/ops/features` (each switch, on or off), `GET /api/ops/assets` (the registry with each asset's pause), `GET /api/ops/summary` (open issues, action and provider event counts, latest checks) | `PATCH /api/ops/features`, `PATCH /api/ops/assets` (pause with a reason, or resume), `POST /api/ops/reconcile` (open issues for stuck actions and failed provider events), `PATCH /api/ops/issues/:id` (acknowledge or resolve) |

## Sign-in and the wallet runtime

Privy, its smart wallets, and wagmi are most of the app's JavaScript, so they load only when needed. `AuthProvider` (`components/auth-provider.tsx`, in the `/app` layout) owns the query client and toasts and decides:

- While the server renders and the page hydrates, it shows a plain "Loading" screen, so a returning customer never sees the guest page flash first; while the runtime downloads for a saved session it shows "Opening your account".
- With a saved Privy session in this browser (`lib/client/privy-session.ts`: a `privy:token` or `privy:refresh_token` key in localStorage, or a `privy-token` or `privy-session` cookie, each possibly with a client segment), it loads the runtime (`components/web3-runtime-provider.tsx`) behind the same loading screen, as before. Privy then decides whether the session is still good.
- Without one, the visitor is a guest: the page renders at once with example data and no Privy code. Sign in fetches the runtime while the page stays as it is, shows "Opening sign-in" meanwhile, mounts it, and opens Privy's sign-in once Privy is ready. If the runtime can't be downloaded, the status says so and the guest can try again. Signing out keeps Privy loaded for the rest of the visit.

Screens never import Privy or wagmi. They read sign-in state from `useAuth()` (`lib/client/auth.tsx`: `ready`, `authenticated`, `user`, `login`, `logout`, `getAccessToken`) and wallet capabilities from `useWallet()` (`lib/client/wallet-context.tsx`: the wallets, MFA methods and enrollment, the authorization signature, card funding, key export, the email flows, connecting a wallet, the previous smart-wallet client). Chain balances come from `useNativeBalance`, `useTokenBalance`, and `useTokenBalances` in the same file: react-query reads through the runtime's wagmi configuration, idle for a guest. The runtime's `PrivyBridge` (`components/privy-bridge.tsx`) fills both contexts from Privy's and wagmi's hooks. Token amounts use `lib/format/units.ts` and ERC-20 transfer calldata `lib/chain/erc20-transfer.ts` (checked against viem), because importing those from viem pulls a shared chunk the bundler groups with the runtime.

`tests/unit/privy-runtime-boundary.test.ts` fails if a file in `components/`, `lib/client/`, or `app/` (outside `app/api`) imports `@privy-io/*`, wagmi, viem's clients or chains, or `config/chains.ts` at runtime, except the runtime and its bridge; type-only imports are fine. Chain identities for screens are in `config/supported-chains.ts`; `config/chains.ts` is the wagmi configuration. End-to-end tests swap `privy-session.ts` for `tests/e2e/support/privy-session-fake.ts`, which counts the fake Privy's signed-in flag as a saved session.

## Routes

Each section has its own route folder (`/app/deposit`, `/app/send`, …) whose page imports only that section's screen, so opening one section doesn't load the others' code; `tests/unit/section-routes.test.ts` keeps it that way. Guests get the same pages: each screen labels its example data and turns actions into sign-in, and the terms gate only applies once signed in. `/app/[section]` only redirects old section names through `lib/product-map.ts` and 404s the rest. Sections grow sub-routes in their folder; `/app/transactions/[id]` is the first.
