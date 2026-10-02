# Aura development Worker

`aura-dev.aurel-events.workers.dev` is the isolated development origin: the `dev` Wrangler environment in `apps/web/wrangler.jsonc`, D1 `aura-dev-projections`, and queue `aura-dev-provider-events`. The docs Worker is `aura-dev-docs.aurel-events.workers.dev`. The operations app is the `aura-dev-ops` Worker (the `dev` environment in `apps/ops/wrangler.jsonc`), which reaches `aura-dev` over a service binding. The production `aurel-financial-os` Worker and its D1 are separate; never touch them without explicit instruction.

## Deploy

Merging to `main` deploys dev. On every push to `main`, without waiting for the `quality` workflow, `.github/workflows/deploy-dev.yml` resets the database if the baseline changed, applies migrations, deploys the events, web, operations, and docs Workers, and runs the deployment smoke. It can also be run by hand from the Actions tab, and never deploys production. Work on branches, and merge the pull request to ship to dev. CI still runs on `main`; if it fails, dev runs code that failed checks until the fix merges.

The workflow needs two secrets on the `dev` GitHub environment (Settings → Environments → dev): `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. The token needs Workers Scripts, D1, and Queues edit permissions on the account.

When GitHub Actions can't run (for example, the month's minutes are used up and jobs fail within seconds with no runner), do both jobs by hand:

- **Checks:** `pnpm ci:local` runs what `ci.yml` and `security.yml` run, including `pnpm audit`. Add `--e2e` for both Playwright projects (the full suite; CI runs it nightly, and pull requests run only the specs for what they change). gitleaks and CodeQL run only if installed; the summary lists what was skipped. Merge once it passes.
- **Deploy:** after merging, check out and pull `main`, then run `pnpm deploy:dev:all`. It runs the same steps as `deploy-dev.yml` (migrations, the four Workers, the smoke), stops unless `main` is clean and matches `origin/main`, needs `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID` in the environment, and only targets `--env dev`.

To deploy single Workers from a machine:

```bash
pnpm deploy:dev          # web Worker
pnpm events:deploy:dev   # provider-event consumer
pnpm ops:deploy:dev      # operations app (builds, then deploys aura-dev-ops)
pnpm docs:deploy:dev     # docs Worker
```

Then run the smoke check:

```bash
AURA_SMOKE_URL=https://aura-dev.aurel-events.workers.dev \
AURA_SMOKE_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev \
pnpm test:deployment
```

## Database

The schema is `infra/d1/migrations/0001_baseline.sql` plus numbered migrations. Since 28 September 2026, migrations are append-only on dev as in production, so dev keeps its customers and transaction records:

- Never edit an applied migration. `apps/web/tests/unit/migrations.test.ts` records each applied file's SHA-256 and fails if one changes.
- To change the schema, add the next numbered file (`0002_snake_case.sql`, …), apply it before deploying code that needs it (the dev deploy runs `wrangler d1 migrations apply` first), then add its hash to that test.
- `pnpm d1:reset:dev` is only for when the owner asks for a clean dev database. It drops every table in `aura-dev-projections`, applies every migration, and turns back on the switches that were on. It erases every dev customer and transaction record; the chain keeps the transactions themselves.

## Configuration

- **Addresses and search engines.** The dev builds name each other: `pnpm deploy:dev` builds the web app with `NEXT_PUBLIC_DOCS_URL=https://aura-dev-docs.aurel-events.workers.dev`, so its docs links, `/docs`, and `/llms.txt` point at the dev docs; `pnpm docs:deploy:dev` builds the docs with `AURA_DOCS_SITE` (their own address, for canonical URLs, the sitemap, and `llms.txt`), `AURA_APP_URL=https://aura-dev.aurel-events.workers.dev` (the header's link back to Aura), and `AURA_DOCS_NOINDEX=1`. Dev is never indexed: robots.txt disallows everything on both Workers, pages carry a noindex robots meta, and every response carries `X-Robots-Tag: noindex, nofollow` (the web Worker adds it outside production, in `apps/web/worker/index.ts`; the docs build adds it to `_headers`). Static files the web Worker's assets serve directly (`/_next/static`, `/images`, `/icons`) don't get the header. The deployment smoke checks the header against robots.txt.
- **Secrets** are set with `wrangler secret put --env dev`, never in `wrangler.jsonc`. `env.dev.secrets.required` in `wrangler.jsonc` lists their names only, so a deploy fails if one is missing. Don't add a secret in the Cloudflare dashboard as a plain-text variable: the next deploy replaces variables with the ones in `wrangler.jsonc` and removes it. Never set live provider modes or copy production secrets here.
- **Privy:** `PRIVY_APP_SECRET` and a development-only webhook signing secret are installed only on `aura-dev`; the local copy of the webhook secret is in the ignored `.aura-dev-webhook-secret`. The origin is in Privy's allowed domains. Anyone can sign in; the first sign-in asks for acceptance of the current terms.
- **Notifications:** `RESEND_API_KEY` (a send-only Resend key) and `VAPID_PRIVATE_KEY` are secrets on `aura-dev` only; `EMAIL_FROM`, `APP_ORIGIN`, and `VAPID_PUBLIC_KEY` are variables. No sending domain is verified in Resend yet, so it sends only from `onboarding@resend.dev` and only to the Resend account owner's address. Notices to anyone else are marked `failed` for email and still show in the app and by push.
- **Email delivery reports:** Resend posts bounces and complaints to `/api/webhooks/resend`, signed with `RESEND_WEBHOOK_SECRET` (a secret, `whsec_…`). In Resend, add a webhook to `https://aura-dev.aurel-events.workers.dev/api/webhooks/resend` for `email.bounced`, `email.complained`, and `email.delivered`, then set its signing secret with `wrangler secret put RESEND_WEBHOOK_SECRET --env dev`. Each email carries a `notification` tag with its notice's ID; a bounce marks that notice's email `failed`. Until the secret is set, the route answers 503 and emails stay marked `sent`.
- **Support chat** is Intercom (`INTERCOM_APP_ID`, a variable). `INTERCOM_IDENTITY_SECRET` (the Messenger security key that signs each customer's identity JWT) and `FIN_CONNECTOR_TOKEN` (the bearer token Fin's data connector sends to `/api/support/fin/activity`) are secrets on `aura-dev` only. In Intercom, turn on Messenger security so only signed identities are accepted, and configure the data connector with that token.
- **Cards** need `STRIPE_SECRET_KEY` (`sk_…`) and `STRIPE_WEBHOOK_SECRET` (`whsec_…`) as secrets, `STRIPE_PUBLISHABLE_KEY` (`pk_…`) and `BRIDGE_CARDS_SPENDER` (Bridge's card contract on Base) as variables, and the `payment_cards` switch; Apple and Google Pay also need `card_wallets`. Point the Stripe webhook at `/api/webhooks/stripe` with `issuing_card.created`, `issuing_card.updated`, `issuing_authorization.created`, and `issuing_transaction.created` (the last two also feed the operations app's money movement). None is set on `aura-dev`: there is no Stripe account or Bridge card program, so Cards shows as coming soon.
- **Operator sign-in** is Cloudflare Access. `CF_ACCESS_TEAM_DOMAIN` (such as `https://<team>.cloudflareaccess.com`) and `CF_ACCESS_AUD` (the Access application's AUD tag) are variables, not secrets, in the `dev` environment of `apps/web/wrangler.jsonc`. While either is empty, every operator request is refused. On `aura-dev` they're set for team `red-surf-47a8` and the `aura-dev-ops` Access application, turned on 28 September 2026. To set it up again (for example for production):
  1. In the Cloudflare dashboard, open Workers & Pages → `aura-dev-ops` → Settings → Domains & Routes, and turn on Cloudflare Access for its workers.dev route.
  2. Give the Access application a policy that allows only the operators' emails.
  3. Copy its AUD tag and the team domain into `CF_ACCESS_AUD` and `CF_ACCESS_TEAM_DOMAIN` for `--env dev`, and deploy the web Worker.
  4. Sign in to the `aura-dev-ops` workers.dev address and check it shows your email.

## Operations app locally

`pnpm ops:dev` runs the operations app with Vite on port 43175 and forwards `/api` to the web dev server's `/api/ops`. There's no Access locally, so operator requests are refused unless `OPS_DEV_ACCESS_TOKEN` holds a token the web dev server can verify, such as one from a local Access fake like the end-to-end tests use (`apps/web/tests/e2e/README.md`).

## What has and has not been exercised

The deployment smoke passes guest browsing, sign-in modal loading, protected-route rejection (including a forged operator Access token on `/api/ops`), webhook signature rejection, and unknown Aura tag privacy. Cloudflare Access is on for the dev operations app (28 September 2026). Funded actions run: an Ethereum-to-Base deposit from a connected wallet ([#21](https://github.com/arthurtouble/crypto-neo-bank/pull/21)), a 1 USDC send on Base, a 2 USDC send from Base to Ethereum through LI.FI ([#24](https://github.com/arthurtouble/crypto-neo-bank/pull/24)), a USDC to AAPLc swap, a deposit into and full withdrawal from a Morpho vault, and 1 USDC received from outside Aura. On 30 September 2026: a 1 USDC Aave deposit and 0.5 USDC withdrawal, and a 1 USDC send from Base to Arbitrum through LI.FI (Layerswap, 0.992048 USDC delivered), each confirmed from chain evidence after Base finality, with the lock, controls, Earn, and send notices emailed. Then Aave Withdraw all: 0.500001 USDC, interest included, leaving no aUSDC, confirmed at 18:22. The Bridge bank and card programs, Stripe Issuing, and acquiring programs aren't connected. Exercise email and wallet sign-in, passkey enrollment, recovery, wallet ownership, logout, and session revocation here before treating authenticated records as verified.
