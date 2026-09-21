# Aurel

Aurel is a Cloudflare-native demonstration of an asset-agnostic private financial interface built over wallets, providers, and public chains. It is intentionally not a bank ledger: provider APIs and chains remain authoritative for customer balances and settlement.

## What is implemented

- Premium marketing site and responsive private-banking dashboard.
- Portfolio, Earn, card, activity, benefits, security, settings, and documentation routes.
- Credential-gated provider boundary; the demo runs safely without Privy or Bridge credentials.
- Normalized identity, wallet, compliance, fiat, card, membership, and chain contracts.
- Interactive partner lab at `/app/sandbox` with new, funded, compliance-review, and failed-transfer scenarios.
- Rebuildable `/api/portfolio` projection with provenance on every position.
- Signed `/api/webhooks/provider` ingress, replay protection, Queue handoff, and retrying event consumer.
- D1 schema limited to disposable projections, consent, preferences, and idempotency metadata.
- `/api/health` endpoint exposing deployment mode and authority model.
- Cloudflare Workers deployment through vinext, with logs and traces configured.
- No internal authoritative balance or settlement store.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for source-of-truth rules, [PARTNER_INTEGRATION.md](./PARTNER_INTEGRATION.md) for Privy/Bridge activation, and [OPERATIONS_RUNBOOK.md](./OPERATIONS_RUNBOOK.md) for recovery and incident procedures.

## Local development

```bash
pnpm install
pnpm dev
```

The app defaults to demonstration mode. Copy `apps/web/.env.example` to `apps/web/.env.local` and set `NEXT_PUBLIC_PRIVY_APP_ID` when a Privy sandbox application is ready.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm build
pnpm deploy:dry-run
```

## Cloudflare deployment

Create the D1 database and queues, replace the placeholder D1 IDs in both Wrangler files, apply the migrations, and set the webhook secret before deployment. Exact commands are in `PARTNER_INTEGRATION.md`.

The web Worker configuration is in `apps/web/wrangler.jsonc`; the Queue consumer is in `apps/events/wrangler.jsonc`.

```bash
pnpm deploy
pnpm events:deploy
```

Do not add provider credentials to `wrangler.jsonc`. Add Bridge, Rain, Privy server, RPC, and webhook secrets with Workers Secrets once those integrations are enabled. Sandbox and production must use separate Cloudflare environments and separate provider programs.

## Data rule

An Aurel database may eventually improve speed and operations, but it must remain disposable. It may contain projections, workflow/idempotency state, user preferences, consent receipts, and provider references. It must not become the source of truth for fiat balances, wallet balances, DeFi positions, loans, or card settlement.
