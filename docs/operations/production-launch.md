---
title: Production launch
description: The ordered steps to take Aura to production, what's ready in the repository, and where to stop for the owner.
---

Nothing is deployed to production. Every step that touches production (a deploy, a migration, a secret, a Cloudflare or partner setting) needs the owner's explicit go-ahead first. `pnpm production:check` reads the Worker configuration, lists what's missing, and exits 1 until it's complete.

The production Workers are `aurel-financial-os` (web), `aurel-provider-event-consumer` (events), `aurel-ops` (operations app), and `aurel-docs` (docs). Their settings are the top level of each `wrangler.jsonc`; `--env dev` is dev.

## 1. Release gates

Every gate in [launch readiness](../overview/launch-readiness.md) is met and recorded. The legal pages name the operating entity and its contact details; until they do, they say the terms don't take effect.

## 2. Domain

Add the custom domains for the app and the docs to Cloudflare, set `APP_ORIGIN` to the app's in the production `vars`, and use it wherever a step below asks for an origin. `APP_ORIGIN` also sets the landing page's canonical address, preview image and structured-data URLs, and sitemap.

The web app and the docs learn each other's address when they're built, not from `wrangler.jsonc`. Export these in the shell that runs `pnpm production:check` and the deploys in step 9; unset, each falls back to a workers.dev address and `pnpm production:check` flags it:

| Build variable | Built into | Set to |
| --- | --- | --- |
| `NEXT_PUBLIC_DOCS_URL` | The web app: its docs links, `/docs`, and `/llms.txt` | The docs' origin, such as `https://docs.<domain>` |
| `AURA_DOCS_SITE` | The docs: canonical URLs, sitemap, preview image, `llms.txt` | The same docs origin |
| `AURA_APP_URL` | The docs: the header's link back to Aura | `APP_ORIGIN` |

Only production is indexed (`apps/web/src/lib/site/seo.ts`). There, `robots.txt` keeps search engines out of the API, payment pages, and the unavailable page, and allows AI crawlers like any other. The app carries a noindex robots meta instead of a `robots.txt` rule, so search engines can read it. The landing page has structured data (organisation, site, app, and its questions), and `/llms.txt` summarises Aura for AI tools; the docs serve `/llms.txt` and `/llms-full.txt`. Everything that isn't production also sends `X-Robots-Tag: noindex, nofollow` ([the development Worker](aura-development-worker.md#configuration)). `/manifest.webmanifest` lets people add Aura to a home screen, which iPhone and iPad need for push notices.

## 3. Privy

1. Create a production Privy app. Don't reuse the development one (`pnpm production:check` flags it).
2. Allow only the production origin.
3. Match the development app's settings: sign-in by email, Google, Telegram, and wallet (the app offers all four, so turn each on; Telegram needs Aura's Telegram bot and the production domain set on it), TEE execution, gas sponsorship on Base, MFA with passkeys, EIP-7702 upgrade ([accounts and custody](../architecture/accounts-and-custody.md)). Card funding (USDC on Base) only once a card provider is approved; then turn on `card_deposits`.
4. Put its app ID in `NEXT_PUBLIC_PRIVY_APP_ID`.
5. Set `PRIVY_APP_SECRET` and `PRIVY_WEBHOOK_SECRET` as secrets on `aurel-financial-os`.

## 4. Variables

Set these in the top-level `vars` of `apps/web/wrangler.jsonc`, in a reviewed pull request:

- `EMAIL_FROM`, from a domain verified in Resend;
- `APP_ORIGIN` (step 2);
- `VAPID_PUBLIC_KEY`, from a key pair made for production;
- `INTERCOM_APP_ID`, for the production Intercom workspace;
- `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` (step 7).

`LIFI_INTEGRATOR` and `LIFI_INTEGRATOR_FEE` are already set, as on dev.

## 5. Secrets

Set each with `pnpm --filter @aurel/web exec wrangler secret put <NAME>` (no `--env`). Never put one in `wrangler.jsonc`, a doc, or a test.

| Secret | For |
| --- | --- |
| `PRIVY_APP_SECRET`, `PRIVY_WEBHOOK_SECRET` | Sign-in and Privy webhooks (required) |
| `RESEND_API_KEY` | Email notices (a send-only key) |
| `RESEND_WEBHOOK_SECRET` | Email bounce reports, from the Resend webhook for `/api/webhooks/resend` |
| `VAPID_PRIVATE_KEY` | Push notices |
| `INTERCOM_IDENTITY_SECRET`, `FIN_CONNECTOR_TOKEN` | Support chat |
| `LIFI_API_KEY` | Swap and cross-chain quotes |
| `BRIDGE_API_KEY` | Bank transfers, once Bridge approves the program |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Cards, once the card program exists |

Bank transfers and cards also need variables: `BRIDGE_WEBHOOK_PUBLIC_KEY`, `STRIPE_PUBLISHABLE_KEY`, and `BRIDGE_CARDS_SPENDER`. Set a partner's secrets and variables only once its production program is approved; until then its feature switch stays off.

## 6. Database and queues

1. Check that the production D1 database in `wrangler.jsonc` (`aurel-projections`) exists with `wrangler d1 list`. If it doesn't, create it and put its ID in both the web and events configuration.
2. Check that the queues `aurel-provider-events` and `aurel-provider-events-dlq` exist with `wrangler queues list`, and create them if not.
3. Apply the migrations: `pnpm --filter @aurel/web exec wrangler d1 migrations apply aurel-projections --remote`.
4. D1 Time Travel keeps point-in-time history on its own (30 days on the Workers Paid plan). Run the [recovery exercise](operations-runbook.md#d1-loss-or-corruption) once against production.

## 7. Operations app

Deploy `aurel-ops`, put Cloudflare Access in front of it allowing only the operators' emails, and copy the team domain and AUD tag into the web variables, as for dev in [the development Worker](aura-development-worker.md#configuration).

## 8. Edge and monitoring

1. Apply the [edge security activation](edge-security-activation.md) settings: WAF, rate limits, API Shield.
2. Set up the alerts in [monitoring and alerts](monitoring.md), send a test alert, and record it.
3. The block on [sanctioned places](../compliance/legal-and-jurisdiction-decisions.md#blocked-places) needs no setup: it runs in the web Worker.

## 9. Deploy

In this order, from an up-to-date `main` with `pnpm production:check` passing in a shell that has the build variables from step 2:

1. `pnpm docs:deploy`
2. `pnpm events:deploy`
3. The web Worker, as a candidate first: follow [production release](operations-runbook.md#production-release) (upload, smoke the preview, then a gradual rollout).
4. `pnpm --filter @aurel/ops deploy`

Then smoke it: `AURA_SMOKE_URL=https://<domain> AURA_SMOKE_DOCS_URL=https://<docs domain> pnpm test:deployment`. On production it expects no `X-Robots-Tag`, and checks `/llms.txt`, the manifest, and the landing page's structured data.

## 10. Switch features on

All feature switches start off in a new database. Turn each on in the operations app only after it passes its gate in [launch controls](launch-controls.md), starting with those that need no partner: send, swaps, cross-chain, and Earn.
