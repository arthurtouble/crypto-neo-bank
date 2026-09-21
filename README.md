# Aurel

Aurel is a Cloudflare-native demonstration of an asset-agnostic private financial interface built over wallets, providers, and public chains. It is intentionally not a bank ledger: provider APIs and chains remain authoritative for customer balances and settlement.

## What is implemented

- Premium marketing site and responsive private-banking dashboard.
- Portfolio, Earn, card, activity, benefits, security, settings, and documentation routes.
- Credential-gated Privy provider boundary; the demo runs safely without a Privy app ID.
- Normalized Bridge/chain adapter contracts and deterministic demo adapters.
- Rebuildable `/api/portfolio` projection with provenance on every position.
- `/api/health` endpoint exposing deployment mode and authority model.
- Cloudflare Workers deployment through vinext, with logs and traces configured.
- No database binding and no internal authoritative balance store.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the source-of-truth and recovery rules, and [PRODUCT_IMPLEMENTATION_PLAN.md](./PRODUCT_IMPLEMENTATION_PLAN.md) for the product roadmap.

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
pnpm build
pnpm deploy:dry-run
```

## Cloudflare deployment

The Worker configuration is in `apps/web/wrangler.jsonc`. Authenticate Wrangler against the intended Cloudflare account, verify that the Worker name is available, then run:

```bash
pnpm deploy
```

Do not add provider credentials to `wrangler.jsonc`. Add Bridge, Rain, Privy server, RPC, and webhook secrets with Workers Secrets once those integrations are enabled. Sandbox and production must use separate Cloudflare environments and separate provider programs.

## Data rule

An Aurel database may eventually improve speed and operations, but it must remain disposable. It may contain projections, workflow/idempotency state, user preferences, consent receipts, and provider references. It must not become the source of truth for fiat balances, wallet balances, DeFi positions, loans, or card settlement.

