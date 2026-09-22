# Aurel

Aurel is a Cloudflare-native, mainnet-first private financial interface built over user-controlled wallets, providers, and public chains. It is intentionally not a bank ledger: provider APIs and chains remain authoritative for customer balances and settlement.

## What is implemented

- Premium marketing site and responsive private-client workspace.
- Live Base ETH, USDC, and WETH portfolio reads plus authenticated Aurel intent history.
- User-confirmed sends, multichain USDC routing, Aave Earn, collateralized borrowing, and repayment preparation.
- Privy authentication, embedded/external wallet support, MFA/recovery/export surfaces, and server-side token verification.
- Membership projections, vendor-neutral benefit entitlements, and a read-only AI concierge.
- Fail-closed tokenized-market eligibility, restricted operations/reconciliation, and an effective-dated trust center.
- Rate-limited protected APIs, security headers, signed webhooks, replay protection, Queue handoff, and structured Cloudflare observability.
- Managed Turnstile protection on support intake with server-side action and production-hostname validation.
- Portfolio, Earn, Borrow, Move, activity, benefits, markets, security, settings, and documentation routes.
- Credential-gated regulated-provider boundary; Bridge/Rain functions remain unavailable until a program is approved.
- Normalized identity, wallet, compliance, fiat, card, membership, and chain contracts.
- Interactive partner lab at `/app/sandbox` with new, funded, compliance-review, and failed-transfer scenarios.
- Signed `/api/webhooks/provider` ingress, replay protection, Queue handoff, and retrying event consumer.
- D1 schema separates rebuildable financial projections from retained Aurel policy, audit, consent, support, and recovery evidence.
- `/api/health` endpoint exposing deployment mode and authority model.
- Cloudflare Workers deployment through vinext, with logs and traces configured.
- No internal authoritative balance or settlement store.

Read the internal [architecture](./apps/kb/src/content/docs/architecture/architecture.md) for source-of-truth rules, [partner integration](./apps/kb/src/content/docs/architecture/partner-integration.md) for Privy/provider activation, [partner diligence](./apps/kb/src/content/docs/compliance/partner-diligence.md) for the provider pack, and the [operations runbook](./apps/kb/src/content/docs/operations/operations-runbook.md) for recovery and incident procedures.

## Documentation

- `apps/docs` is the public customer documentation.
- `apps/kb` is the internal knowledge base for product, architecture, operations, security, compliance, providers, and growth.
- The internal site must remain behind Cloudflare Access. `robots.txt` and page metadata are indexing safeguards, not authorization.

```bash
pnpm docs:dev
pnpm kb:dev
pnpm docs:build
pnpm kb:build
```

## Local development

```bash
pnpm install
pnpm dev
```

Local development is the only development environment and uses isolated Miniflare state. The deployed Worker is production; there is no staging environment. The app defaults to mainnet-preview mode. Its production Privy app ID is a public build-time fallback; set `NEXT_PUBLIC_PRIVY_APP_ID` to override it for a separate local Privy application. Mainnet writes always require an explicit wallet confirmation.

## Quality checks

```bash
pnpm typecheck
pnpm lint
pnpm test:unit
pnpm test:e2e
pnpm test:mainnet-readiness
pnpm test:production
pnpm test:recovery
pnpm build
pnpm deploy:dry-run
```

## Cloudflare deployment

The current mainnet-preview environment is deployed to Cloudflare:

- Web app: <https://aurel-financial-os.aurel-events.workers.dev>
- Provider-event consumer: <https://aurel-provider-event-consumer.aurel-events.workers.dev>
- Disposable projections: D1 database `aurel-projections` (EU jurisdiction)
- Event transport: `aurel-provider-events` with `aurel-provider-events-dlq`

Privy authentication and direct Base reads are live in this environment. Direct DeFi and cross-chain routes are prepared from live mainnet data and require the customer to sign. Fiat transfers, cards, and vendor-funded benefits remain unavailable until their respective partner programs and credentials are activated; the provider lab is clearly separated and illustrative.

Create the D1 database and queues, replace the placeholder D1 IDs in both Wrangler files, apply the migrations, and set the webhook secret before deployment. Exact commands are in the internal [partner integration guide](./apps/kb/src/content/docs/architecture/partner-integration.md).

The web Worker configuration is in `apps/web/wrangler.jsonc`; the Queue consumer is in `apps/events/wrangler.jsonc`.

```bash
pnpm deploy
pnpm events:deploy
```

Do not add provider credentials to `wrangler.jsonc`. Add Bridge, Rain, Privy server, Turnstile, RPC, and webhook secrets with Workers Secrets once those integrations are enabled. Development and production must use separate provider applications or programs.

## Data rule

An Aurel database must never become the source of truth for fiat balances, wallet balances, DeFi positions, loans, or card settlement. Financial projections are rebuildable; security policies, customer instructions, consent receipts, cases, and audit evidence are operational records that require retention and recovery even though they do not authorize or prove a balance.

See [launch readiness](./apps/kb/src/content/docs/overview/launch-readiness.md) for the closed-beta gates, the [closed-beta plan](./apps/kb/src/content/docs/operations/closed-beta-plan.md) for cohort controls, the [acceptance test plan](./apps/kb/src/content/docs/operations/acceptance-test-plan.md) for funded-wallet evidence, and the [threat model](./apps/kb/src/content/docs/security/threat-model.md) for the security boundary.
