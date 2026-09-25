# Aura

Aura is the customer-facing financial app in this repository. The existing infrastructure package names, deployment IDs, and historical records retain `aurel` where renaming them would change operational or legal meaning. No legal entity name has been changed.

## Product

Visitors can browse every section with fictional, labeled example data. Anyone can sign in. Personal data needs a verified session, and financial actions are gated by server-side feature switches, account locks, per-account daily limits, and transaction policy. The customer navigation is Overview, Deposit, Send, Swap, Earn, Borrow, Invest, Cards, Rewards, Transactions, Insights, Settings, and Support.

Wallet and protocol balances come from public chains and providers. Fiat, card, and securities records come from connected providers. D1 stores projections, policies, audit evidence, consent, cases, and recovery records; it is not the authority for balances or settlement.

The development app supports Privy wallets, Base balances and sends, reviewed direct Uniswap swaps on Base and LI.FI/Across USDC bridges, Aave supply/withdraw/borrow/repay, and Ethereum USDC deposits into and withdrawals from Sky sUSDS. Chain and protocol records decide the result. The public Aura tag page can show an opted-in member's verified wallet address. Bridge bank transfers, cards, securities execution, and rewards need provider programs that are not connected. See [current availability](./apps/docs/src/content/docs/getting-started/status.md).

## Local development

```bash
pnpm install
pnpm dev
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
```

For an already deployed environment, set `AURA_SMOKE_URL` to its exact origin and run `pnpm test:deployment`. Set `AURA_SMOKE_DOCS_URL` when its docs origin differs from the current production docs origin. The command has no default app target.

The web app is in `apps/web`, public documentation is in `apps/docs`, and internal documentation (architecture, runbooks, security, compliance) is in [`docs/`](./docs/README.md). Cloudflare bindings are configured in `apps/web/wrangler.jsonc`; D1 migrations are in `infra/d1/migrations`. Local development uses isolated Miniflare state. This branch is deployed only to the isolated [Aura development Worker](./docs/operations/aura-development-worker.md). The original Worker and D1 are separate.

## Integration and release boundary

The [architecture guide](./docs/architecture/architecture.md) explains source-of-truth rules. The [partner integration guide](./docs/architecture/partner-integration.md) and [operations runbook](./docs/operations/operations-runbook.md) cover provider activation, secrets, migrations, reconciliation, and recovery. Apply reviewed migrations and run release checks before any deployment. Never put provider credentials in `wrangler.jsonc`.

The retired waitlist, referral, campaign, experiment, goal, bill, income-plan, transfer-schedule, price-alert, and swap-reminder features have no routes or tables, and the private-beta invitation gate is gone. Migrations `0040_drop_retired_features.sql` and `0041_open_access.sql` drop their storage; audit events that reference those records are retained.

Customers accept the current terms of use and privacy notice on first sign-in (`/api/terms`). Settings offers notification choices, product-update consent, and data export and deletion; `apps/web/src/lib/privacy/subject-data.ts` classifies every customer-data table. Provider events for cards, memberships and benefits, and wallet rules are applied by the events Worker using `packages/provider-projections`; see [provider projections](./docs/architecture/provider-projections.md).

API handlers use the shared wrapper in `apps/web/src/lib/http/route.ts`, which assigns a trace ID, maps known errors to safe responses, logs unexpected failures, and defaults responses to `no-store`. `tests/unit/api-route-inventory.test.ts` fails if a new handler bypasses it without being listed as a public or special-contract route.
