# Aura development Worker

`aura-dev.aurel-events.workers.dev` is the isolated development origin. It uses the `dev` Wrangler environment in `apps/web/wrangler.jsonc`, D1 `aura-dev-projections`, and queue `aura-dev-provider-events`. The original `aurel-financial-os` Worker and D1 are separate.

Run `pnpm deploy:dev` from the repository root to build and deploy this Worker. Apply future migrations with `pnpm --filter @aurel/web exec wrangler d1 migrations apply aura-dev-projections --remote --env dev` after reviewing them. The initial empty D1 was migrated through `0037_aura_tag_bank_consent.sql` on 24 September 2026.

This origin can show the landing page and labeled example-data product tour without credentials. Privy sign-in needs a development `PRIVY_APP_SECRET` installed on `aura-dev`, plus the origin in Privy's allowed origins. Turnstile needs its secret and hostname configuration. Provider webhooks need their own development signing secret. Do not copy production secrets into this Worker or set live provider modes for a demo. Financial action flags remain off. The Bridge, Rain, acquiring, securities, and rewards programs are still unconnected.

Use Cloudflare's secret controls for credentials; never commit them. After enabling Privy, exercise sign-in, invitation/recovery, wallet ownership, logout and session revocation on this origin before showing authenticated records. Confirm `/api/health`, the example-data tour, a private API returning 401 without a token, and the public Aura tag unavailable state after every deployment.
