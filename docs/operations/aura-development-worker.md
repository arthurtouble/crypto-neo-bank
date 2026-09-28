# Aura development Worker

`aura-dev.aurel-events.workers.dev` is the isolated development origin. It uses the `dev` Wrangler environment in `apps/web/wrangler.jsonc`, D1 `aura-dev-projections`, and queue `aura-dev-provider-events`. The docs Worker is `aura-dev-docs.aurel-events.workers.dev`, and the operations app is the `aura-dev-ops` Worker (the `dev` environment in `apps/ops/wrangler.jsonc`), which reaches `aura-dev` over a service binding. The original `aurel-financial-os` Worker and its D1 are separate; never touch them without explicit instruction.

## Deploy

Merging to `main` deploys dev. On every push to `main`, without waiting for the `quality` workflow, `.github/workflows/deploy-dev.yml` resets the database if the baseline changed, applies migrations, deploys the events, web, operations, and docs Workers, and runs the deployment smoke. Work happens on branches; open a pull request and merge it right away to ship to dev. CI still runs on `main`; when it fails, dev is running code that failed checks until the fix merges. The workflow can also be run by hand from the Actions tab. It never deploys production.

It needs two secrets on the `dev` GitHub environment (Settings → Environments → dev): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts, D1, and Queues edit permissions on the account.

To deploy from a machine instead:

```bash
pnpm deploy:dev          # web Worker
pnpm events:deploy:dev   # provider-event consumer
pnpm ops:deploy:dev      # operations app (builds, then deploys aura-dev-ops)
pnpm docs:deploy:dev     # docs Worker
```

After a manual deployment, run the smoke check:

```bash
AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev \
AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev \
pnpm test:deployment
```

## Database

The schema is `infra/d1/migrations/0001_baseline.sql` plus numbered migrations after it. Since 28 September 2026, migrations are append-only on dev as they will be in production, so dev keeps its customers and transaction records:

- Never edit a migration that has been applied. `apps/web/tests/unit/migrations.test.ts` records each applied file's SHA-256 and fails if one changes.
- To change the schema, add the next numbered file (`0002_snake_case.sql`, …). Apply it before deploying code that needs it (the dev deploy runs `wrangler d1 migrations apply` first), then add its hash to that test.
- `pnpm d1:reset:dev` still exists, for when the owner asks for a clean dev database. It drops every table in `aura-dev-projections`, applies every migration, and turns back on the feature switches that were on. It erases every dev customer and transaction record; the chain keeps the transactions themselves.

## Configuration

- Secrets are set with `wrangler secret put --env dev`, never in `wrangler.jsonc`. `PRIVY_APP_SECRET` and a development-only webhook signing secret are installed only on `aura-dev`. The local copy of the webhook secret is in the ignored `.aura-dev-webhook-secret`. Notifications use `RESEND_API_KEY` (a send-only Resend key) and `VAPID_PRIVATE_KEY`, both secrets on `aura-dev` only; `EMAIL_FROM`, `APP_ORIGIN`, and `VAPID_PUBLIC_KEY` are variables. No sending domain is verified in Resend yet, so it sends only from `onboarding@resend.dev` and only to the Resend account owner's address; notices to anyone else are marked `failed` for email and still show in the app and by push.
- Support chat is Intercom (app `INTERCOM_APP_ID` as a variable). `INTERCOM_IDENTITY_SECRET` (the Messenger security key that signs each customer's identity JWT) and `FIN_CONNECTOR_TOKEN` (the bearer token Intercom's Fin data connector sends to `/api/support/fin/activity`) are secrets on `aura-dev` only. In Intercom, turn on Messenger security so only signed identities are accepted, and configure the data connector with that token.
- Cards need `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`) as secrets, and `STRIPE_PUBLISHABLE_KEY` (`pk_…`) and `BRIDGE_CARDS_SPENDER` (Bridge's card contract on Base) as variables, plus the `payment_cards` switch. Point the Stripe webhook at `/api/webhooks/stripe` with `issuing_card.created`, `issuing_card.updated`, `issuing_authorization.created`, and `issuing_transaction.created`; the last two also put card payments in the operations app's money movement. Apple and Google Pay also need `card_wallets`. None is set on `aura-dev` yet: there is no Stripe account or Bridge card program, so the Cards page shows cards as coming soon.
- Operator sign-in is Cloudflare Access. The web app's `CF_ACCESS_TEAM_DOMAIN` (the team domain, such as `https://<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the Access application's AUD tag) are variables in the `dev` environment of `apps/web/wrangler.jsonc`, not secrets. While either is empty, every operator request is refused. On `aura-dev` they're set for the team `red-surf-47a8` and the `aura-dev-ops` Access application, turned on 28 September 2026. To set it up again (for example for production):
  1. In the Cloudflare dashboard, open Workers & Pages → `aura-dev-ops` → Settings → Domains & Routes, and turn on Cloudflare Access for its workers.dev route.
  2. Give the Access application a policy that allows only the operators' emails.
  3. Copy the application's AUD tag and the team domain into `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` for `--env dev`, and deploy the web Worker.
  4. Sign in to the `aura-dev-ops` workers.dev address and check that it shows your email.
- The origin is in Privy's allowed domains. Anyone can sign in; the first sign-in asks for acceptance of the current terms.
- Never set live provider modes or copy production secrets here.

## Operations app locally

`pnpm ops:dev` runs the operations app with Vite on port 43175 and forwards `/api` to the web dev server's `/api/ops`. Access isn't there locally, so operator requests are refused unless `OPS_DEV_ACCESS_TOKEN` holds a token that the web dev server can verify, such as one from a local fake of Access like the end-to-end tests use (`apps/web/tests/e2e/README.md`).

## What has and has not been exercised

Guest browsing, sign-in modal loading, protected-route rejection (including a forged operator Access token on `/api/ops`), webhook signature rejection, and unknown Aura tag privacy pass the deployment smoke. The operations app hasn't been signed in to on dev, because Access isn't on yet. Funded customer actions that have run: an Ethereum-to-Base deposit from a connected wallet ([#21](https://github.com/arthurtouble/crypto-neo-bank/pull/21)), a 1 USDC send on Base, and a 2 USDC send from Base to Ethereum through LI.FI ([#24](https://github.com/arthurtouble/crypto-neo-bank/pull/24)). No funded swap, Aave, or Morpho action has run, and the Bridge bank and card programs, Stripe Issuing, and acquiring programs are not connected. Exercise email and wallet sign-in, passkey enrollment, recovery, wallet ownership, logout, and session revocation here before treating authenticated records as verified.
