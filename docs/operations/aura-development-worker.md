# Aura development Worker

`aura-dev.aurel-events.workers.dev` is the isolated development origin. It uses the `dev` Wrangler environment in `apps/web/wrangler.jsonc`, D1 `aura-dev-projections`, and queue `aura-dev-provider-events`. The docs Worker is `aura-dev-docs.aurel-events.workers.dev`. The original `aurel-financial-os` Worker and its D1 are separate; never touch them without explicit instruction.

## Deploy

Merging to `main` deploys dev. On every push to `main`, without waiting for the `quality` workflow, `.github/workflows/deploy-dev.yml` resets the database if the baseline changed, applies migrations, deploys the events, web, and docs Workers, and runs the deployment smoke. Work happens on branches; open a pull request and merge it right away to ship to dev. CI still runs on `main`; when it fails, dev is running code that failed checks until the fix merges. The workflow can also be run by hand from the Actions tab. It never deploys production.

It needs two secrets on the `dev` GitHub environment (Settings → Environments → dev): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts, D1, and Queues edit permissions on the account.

To deploy from a machine instead:

```bash
pnpm deploy:dev          # web Worker
pnpm events:deploy:dev   # provider-event consumer
pnpm docs:deploy:dev     # docs Worker
```

After a manual deployment, run the smoke check:

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

The reset drops every table in `aura-dev-projections`, applies the current schema, and turns back on the feature switches that were on. Development data is disposable. It records the baseline's hash in `dev_schema_state`, and `--if-schema-changed` resets only when the hash differs. The dev deploy uses that, so a merged schema change resets dev by itself.

## Configuration

- Secrets are set with `wrangler secret put --env dev`, never in `wrangler.jsonc`. `PRIVY_APP_SECRET`, the Turnstile test secret, and a development-only webhook signing secret are installed only on `aura-dev`. The local copy of the webhook secret is in the ignored `.aura-dev-webhook-secret`.
- Turnstile uses [Cloudflare's test keys](https://developers.cloudflare.com/turnstile/troubleshooting/testing/), which are not a production bot control.
- The origin is in Privy's allowed domains. Anyone can sign in; the first sign-in asks for acceptance of the current terms.
- Never set live provider modes or copy production secrets here.

## What has and has not been exercised

Guest browsing, sign-in modal loading, protected-route rejection, webhook signature rejection, and unknown Aura tag privacy pass the deployment smoke. Funded customer actions that have run: an Ethereum-to-Base deposit from a connected wallet ([#21](https://github.com/arthurtouble/crypto-neo-bank/pull/21)), a 1 USDC send on Base, and a 2 USDC send from Base to Ethereum through LI.FI ([#24](https://github.com/arthurtouble/crypto-neo-bank/pull/24)). No funded swap, Aave, or Morpho action has run, and Bridge, Rain, and acquiring programs are not connected. Exercise email and wallet sign-in, passkey enrollment, recovery, wallet ownership, logout, and session revocation here before treating authenticated records as verified.
