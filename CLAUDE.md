# CLAUDE.md

Aura is a crypto-and-fiat money app built on Cloudflare Workers. Infrastructure, package names (`@aurel/*`), Worker names, and historical records keep the older `aurel` name on purpose; don't rename them.

## Layout

- `apps/web`: customer app (vinext = Next.js App Router on Vite, deployed as a Worker). Pages are in `src/app`, API handlers in `src/app/api`, domain logic in `src/lib`.
- `apps/events`: queue consumer Worker (`aurel-provider-event-consumer`) that applies signed provider events to D1 projections.
- `apps/docs`: public Astro docs Worker. Customer-facing copy.
- `apps/ops`: the operations app (Vite + React, its own Worker behind Cloudflare Access). Its Worker forwards `/api/*` to the web app's `/api/ops/*` over a service binding; those routes verify the Access token (`apps/web/src/lib/auth/access.ts`). Operators never sign in with Privy.
- `packages/provider-projections`: shared event contract used by web and events.
- `infra/d1/migrations`: D1 schema: `0001_baseline.sql`, then numbered `NNNN_snake_case.sql` files, shared by all Workers.
- `docs/`: internal docs (architecture, runbooks, security, compliance). Read `docs/README.md` first. Dated files are point-in-time evidence; don't edit them, update the undated doc instead.

## Commands (repo root)

```bash
pnpm install
pnpm dev                 # web app on vinext dev
pnpm ops:dev             # operations app on Vite (port 43175), calling the web dev server
pnpm lint                # eslint, web
pnpm typecheck:all       # tsc/astro check, every package (CI runs this)
pnpm test:unit           # vitest (web) + scripts/mainnet-readiness.test.mjs
pnpm test:e2e            # builds, then Playwright desktop + mobile Chromium
pnpm build
pnpm production:check   # what the production Worker config still lacks (exits 1 until ready)
```

A single unit test: `pnpm --filter @aurel/web exec vitest run tests/unit/<file>.test.ts`.
CI (`.github/workflows/ci.yml`) runs lint, `typecheck:all`, `test:unit`, build, and `test:recovery` in one job, and e2e as two parallel jobs (desktop and mobile Chromium; the tests share one fake chain, so each project runs one test at a time). Run the first three before pushing.

## Current plan: launch

Steps 1 to 3 of `docs/overview/feature-readiness.md` are done, and so is step 4 except the production deployment itself. What's left is on the owner: partner approvals, the production Privy app and variables (`pnpm production:check`), and the go-ahead for each step in `docs/operations/production-launch.md`.

- Build screens only from the design system: tokens in `apps/web/public/design-tokens.css`, rules in `DESIGN.md` and `docs/product/design-system.md`, rendered at `apps/web/public/design-system.html`. No one-off styles, no literal colours. Each area's styles live in an area stylesheet in `src/app` (`shell.css`, `overview.css`, `money.css`, …). The pre-redesign `globals.css`, `identity.css`, and `product-system.css` are trimmed to what the app still renders; don't add to them.
- A behavior change (server logic, API contracts, D1, switches, money rules) is its own pull request.
- Existing e2e specs keep passing; update selectors, never the behavior checked.
- Keep docs in sync with the code in the same pull request: internal docs in `docs/` and public docs in `apps/docs`.

## Non-negotiable rules

- **D1 never owns money.** Balances and settlement come from chains, protocols, and providers. A row in D1 is a replaceable projection, never proof a command succeeded. See `docs/architecture/architecture.md`.
- Every financial observation carries source, external ID, status, and `observedAt`. Stale or failed reads display as unavailable, never as the last value.
- API handlers must use the wrapper in `apps/web/src/lib/http/route.ts`. `tests/unit/api-route-inventory.test.ts` fails otherwise; list genuine exceptions there as public/special-contract routes.
- Only assets in `apps/web/src/lib/assets/registry.ts` can be shown, deposited, sent, swapped, or bought, and the server checks it (`lib/assets/pauses.ts`). Add assets there in a reviewed change and run `pnpm assets:check`; see `docs/architecture/assets.md`.
- New customer-data tables must be classified in `apps/web/src/lib/privacy/subject-data.ts`.
- Financial actions are gated server-side by feature switches (`src/lib/features/flags.ts`, stored in D1), account locks, daily limits, and transaction policy. Never gate only in the UI.
- Migrations are append-only, on dev as in production (since 28 September 2026, so dev keeps its history). Never edit a migration that has been applied; `tests/unit/migrations.test.ts` records each applied file's hash and fails if one changes. Add the next numbered file (`0002_snake_case.sql`, …), apply it with `wrangler d1 migrations apply` before deploying code that needs it, then add its hash to that test. Don't reset the dev database to change the schema; `pnpm d1:reset:dev` wipes every dev record and is only for when the owner asks. No production database exists yet.
- Never put secrets in `wrangler.jsonc`, docs, or tests. Use `wrangler secret put`. `.aura-dev-*` and `.dev.vars` are gitignored for local secrets.
- Guest pages show fictional example data, and it must be labeled as such.

## Writing and UI

- Copy follows `docs/product/content-style-guide.md`: sentence case, short sentences, plain verbs, no implementation jargon ("rail", "orchestration", "intent"), no unsupported claims. `pnpm marketing:check` scans marketing claims.
- Visuals follow `DESIGN.md` and `docs/product/design-system.md`: neutral greys, one ultramarine accent, Geist and Geist Mono, radius 6/8/10px (20px phone sheets, pills), no gradients, glass, or decorative cards. Change a token in `design-tokens.css`, both docs, and the reference page together.

## Cloudflare environments

- `apps/web/wrangler.jsonc` top level = production (`aurel-financial-os`, D1 `aurel-projections`). `--env dev` = isolated dev (`aura-dev`, D1 `aura-dev-projections`, queue `aura-dev-provider-events`).
- Default to dev. Every push to `main` deploys dev right away (`.github/workflows/deploy-dev.yml`), with CI running alongside, so work on branches and merge through pull requests. For quick iteration, a pull request can merge once lint, `typecheck:all`, and `test:unit` pass locally, without waiting for CI; a red CI run on `main` is the next thing to fix. To deploy by hand, use `pnpm deploy:dev`, `pnpm events:deploy:dev`, `pnpm docs:deploy:dev`, `pnpm ops:deploy:dev`; migrate with `pnpm --filter @aurel/web exec wrangler d1 migrations apply aura-dev-projections --remote --env dev`; then smoke with `AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev pnpm test:deployment`.
- When GitHub Actions can't run (no minutes left this month), run `pnpm ci:local` (add `--e2e` for Playwright) before merging, and `pnpm deploy:dev:all` from an up-to-date `main` after merging. See `docs/operations/aura-development-worker.md`.
- Never deploy, migrate, or change secrets on production without explicit instruction. See `docs/operations/aura-development-worker.md` and `docs/operations/operations-runbook.md`.
- Wrangler reads `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` from the environment.

## Claude Code on the web

`.claude/hooks/session-start.sh` runs at session start: `pnpm install`, the `sqlite3` CLI (migration unit tests shell out to it), and an alias so this repo's Playwright can launch the image's preinstalled headless Chromium. Don't run `playwright install`; downloads are blocked.

In the container, the first e2e test to open an `/app` route can time out while the dev server cold-compiles it; the rerun passes and CI retries twice. Re-run before treating it as a regression.
