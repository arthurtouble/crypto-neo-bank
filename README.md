# Aura

Aura is the customer-facing financial app in this repository. The existing infrastructure package names, deployment IDs, and historical records retain `aurel` where renaming them would change operational or legal meaning. No legal entity name has been changed.

## Product

Visitors can browse every section with fictional, labeled example data. Sign-in and the existing invitation, country, and policy controls protect personal data and financial actions. The customer navigation is Overview, Deposit, Send, Swap, Earn, Borrow, Invest, Cards, Rewards, Transactions, Insights, Settings, and Support.

Wallet and protocol balances come from public chains and providers. Fiat, card, and securities records come from connected providers. D1 stores projections, policies, audit evidence, consent, cases, and recovery records; it is not the authority for balances or settlement.

The current implementation supports public browsing, Privy authentication and wallet controls, direct Base reads, guarded crypto-send preparation, LI.FI route discovery through the governed swap flow, Aave position reads, support intake, and a public Aura tag page for opted-in members. The Aura tag page can expose a verified linked crypto address. Bank-transfer instructions, card payments, issuance and controls, securities execution, rewards fulfilment, and Aave writes require provider programs or transaction paths that are not connected. Their screens show that state clearly. See [current availability](./apps/docs/src/content/docs/getting-started/status.md).

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

The web app is in `apps/web`, public documentation is in `apps/docs`, and the internal knowledge base is in `apps/kb`. Cloudflare bindings are configured in `apps/web/wrangler.jsonc`; D1 migrations are in `infra/d1/migrations`. Local development uses isolated Miniflare state. This branch is deployed only to the isolated [Aura development Worker](./docs/operations/aura-development-worker.md). The original Worker and D1 are separate.

## Integration and release boundary

The [architecture guide](./apps/kb/src/content/docs/architecture/architecture.md) explains source-of-truth rules. The [partner integration guide](./apps/kb/src/content/docs/architecture/partner-integration.md) and [operations runbook](./apps/kb/src/content/docs/operations/operations-runbook.md) cover provider activation, secrets, migrations, reconciliation, and recovery. Apply reviewed migrations and run release checks before any deployment. Never put provider credentials in `wrangler.jsonc`.

Legacy growth and planning records remain stored for retention and recovery even though the corresponding customer-facing waitlist, goals, alerts, schedules, paycheck planning, and concierge UI have been removed.
