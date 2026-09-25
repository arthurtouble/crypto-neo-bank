# CLAUDE.md

Aura is a crypto-and-fiat money app built on Cloudflare Workers. Infrastructure, package names (`@aurel/*`), Worker names, and historical records keep the older `aurel` name on purpose; don't rename them.

## Layout

- `apps/web`: customer app (vinext = Next.js App Router on Vite, deployed as a Worker). Pages are in `src/app`, API handlers in `src/app/api`, domain logic in `src/lib`.
- `apps/events`: queue consumer Worker (`aurel-provider-event-consumer`) that applies signed provider events to D1 projections.
- `apps/docs`: public Astro docs Worker. Customer-facing copy.
- `packages/provider-projections`: shared event contract used by web and events.
- `infra/d1/migrations`: numbered D1 migrations (`NNNN_snake_case.sql`), shared by all Workers.
- `docs/`: internal docs (architecture, runbooks, security, compliance). Read `docs/README.md` first. Dated files are point-in-time evidence; don't edit them, update the undated doc instead.

## Commands (repo root)

```bash
pnpm install
pnpm dev                 # web app on vinext dev
pnpm lint                # eslint, web
pnpm typecheck:all       # tsc/astro check, every package (CI runs this)
pnpm test:unit           # vitest (web) + scripts/mainnet-readiness.test.mjs
pnpm test:e2e            # builds, then Playwright desktop + mobile Chromium
pnpm build
```

A single unit test: `pnpm --filter @aurel/web exec vitest run tests/unit/<file>.test.ts`.
CI (`.github/workflows/ci.yml`) runs lint, `typecheck:all`, `test:unit`, build, e2e, and `test:recovery`. Run the first three before pushing.

## Non-negotiable rules

- **D1 never owns money.** Balances and settlement come from chains, protocols, and providers. A row in D1 is a replaceable projection, never proof a command succeeded. See `docs/architecture/architecture.md`.
- Every financial observation carries source, external ID, status, and `observedAt`. Stale or failed reads display as unavailable, never as the last value.
- API handlers must use the wrapper in `apps/web/src/lib/http/route.ts`. `tests/unit/api-route-inventory.test.ts` fails otherwise; list genuine exceptions there as public/special-contract routes.
- New customer-data tables must be classified in `apps/web/src/lib/privacy/subject-data.ts`.
- Financial actions are gated server-side by feature switches (`src/lib/features/flags.ts`, stored in D1), account locks, daily limits, and transaction policy. Never gate only in the UI.
- Migrations are append-only: add a new numbered file, never edit an applied one. Apply migrations before deploying code that needs them.
- Never put secrets in `wrangler.jsonc`, docs, or tests. Use `wrangler secret put`. `.aura-dev-*` and `.dev.vars` are gitignored for local secrets.
- Guest pages show fictional example data, and it must be labeled as such.

## Writing and UI

- Copy follows `docs/product/content-style-guide.md`: sentence case, short sentences, plain verbs, no implementation jargon ("rail", "orchestration", "intent"), no unsupported claims. `pnpm marketing:check` scans marketing claims.
- Visuals follow `docs/product/design-system.md` (anti-slop contract: no gradient blobs, glass, filler cards; three radius tiers 5/8/12px). The reference page is `apps/web/public/design-system.html`.

## Cloudflare environments

- `apps/web/wrangler.jsonc` top level = production (`aurel-financial-os`, D1 `aurel-projections`). `--env dev` = isolated dev (`aura-dev`, D1 `aura-dev-projections`, queue `aura-dev-provider-events`).
- Default to dev. Deploy with `pnpm deploy:dev`, `pnpm events:deploy:dev`, `pnpm docs:deploy:dev`; migrate with `pnpm --filter @aurel/web exec wrangler d1 migrations apply aura-dev-projections --remote --env dev`; then smoke with `AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev pnpm test:deployment`.
- Never deploy, migrate, or change secrets on production without explicit instruction. See `docs/operations/aura-development-worker.md` and `docs/operations/operations-runbook.md`.
- Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment.

## Claude Code on the web

`.claude/hooks/session-start.sh` runs `pnpm install` at session start. Chromium is preinstalled; don't run `playwright install`.
