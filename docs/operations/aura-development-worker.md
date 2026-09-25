# Aura development Worker

`aura-dev.aurel-events.workers.dev` is the isolated development origin. It uses the `dev` Wrangler environment in `apps/web/wrangler.jsonc`, D1 `aura-dev-projections`, and queue `aura-dev-provider-events`. The docs Worker is `aura-dev-docs.aurel-events.workers.dev`. The original `aurel-financial-os` Worker and its D1 are separate; never touch them without explicit instruction.

## Deploy

```bash
pnpm deploy:dev          # web Worker
pnpm events:deploy:dev   # provider-event consumer
pnpm docs:deploy:dev     # docs Worker
```

After every deployment, run the smoke check:

```bash
AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev \
AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev \
pnpm test:deployment
```

## Database

The schema is `infra/d1/migrations/0001_baseline.sql`. Until production is migrated, schema changes edit the baseline, and the dev database is reset rather than migrated:

```bash
pnpm d1:reset:dev
```

The reset drops every table in `aura-dev-projections` and applies the current schema. Development data is disposable. It then needs the feature switches it had before, which the baseline seeds as off; turn them on from the operations console or with `wrangler d1 execute`.

Adopting the baseline on 25 September 2026 requires one reset, because the dev database was migrated through the retired numbered files (last `0039`).

## Configuration

- Secrets are set with `wrangler secret put --env dev`, never in `wrangler.jsonc`. `PRIVY_APP_SECRET`, the Turnstile test secret, and a development-only webhook signing secret are installed only on `aura-dev`. The local copy of the webhook secret is in the ignored `.aura-dev-webhook-secret`.
- Turnstile uses [Cloudflare's test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), which are not a production bot control.
- The origin is in Privy's allowed domains. Anyone can sign in; the first sign-in asks for acceptance of the current terms.
- Never set live provider modes or copy production secrets here.

## What has and has not been exercised

Guest browsing, sign-in modal loading, protected-route rejection, webhook signature rejection, and unknown Aura tag privacy pass the deployment smoke. No customer transaction has been signed, no funded swap, bridge, Aave, or Sky action has run, and Bridge, Rain, and acquiring programs are not connected. Exercise sign-in, recovery, wallet ownership, logout, and session revocation here before treating authenticated records as verified.
