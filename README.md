# Aura

Aura is the customer-facing financial app in this repository. The existing infrastructure package names, deployment IDs, and historical records retain `aurel` where renaming them would change operational or legal meaning. No legal entity name has been changed.

## Product

Visitors can browse every section with fictional, labeled example data. Sign-in and the existing invitation, country, and policy controls protect personal data and financial actions. The customer navigation is Overview, Deposit, Send, Swap, Earn, Borrow, Invest, Cards, Rewards, Transactions, Insights, Settings, and Support.

Wallet and protocol balances come from public chains and providers. Fiat, card, and securities records come from connected providers. D1 stores projections, policies, audit evidence, consent, cases, and recovery records; it is not the authority for balances or settlement.

The development app supports Privy wallets, Base balances and sends, reviewed LI.FI swaps and bridges, Aave supply/withdraw/borrow/repay, and Ethereum USDC deposits into and withdrawals from Sky sUSDS. Chain and protocol records decide the result. The public Aura tag page can show an opted-in member's verified wallet address. Bridge bank transfers, cards, securities execution, and rewards need provider programs that are not connected. See [current availability](./apps/docs/src/content/docs/getting-started/status.md).

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

The web app is in `apps/web`, public documentation is in `apps/docs`, and the internal knowledge base is in `apps/kb`. Cloudflare bindings are configured in `apps/web/wrangler.jsonc`; D1 migrations are in `infra/d1/migrations`. Local development uses isolated Miniflare state. This branch is deployed only to the isolated [Aura development Worker](./docs/operations/aura-development-worker.md). The original Worker and D1 are separate.

## Integration and release boundary

The [architecture guide](./apps/kb/src/content/docs/architecture/architecture.md) explains source-of-truth rules. The [partner integration guide](./apps/kb/src/content/docs/architecture/partner-integration.md) and [operations runbook](./apps/kb/src/content/docs/operations/operations-runbook.md) cover provider activation, secrets, migrations, reconciliation, and recovery. Apply reviewed migrations and run release checks before any deployment. Never put provider credentials in `wrangler.jsonc`.

Legacy growth and planning records remain stored for retention and recovery even though the corresponding customer-facing waitlist, goals, alerts, schedules, paycheck planning, and concierge UI have been removed.
