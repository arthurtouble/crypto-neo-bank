# Aura

Aura is a crypto-and-fiat money app on Cloudflare Workers. Infrastructure, package names (`@aurel/*`), Worker names, and historical records keep the older `aurel` name on purpose; no legal entity name has changed.

## Product

The customer navigation is Overview, Deposit, Send, Swap, Earn, Cards, Transactions, Insights, Settings, and Support. Visitors can browse every section with fictional, labeled example data. Anyone can sign in with email or a wallet through Privy, except from sanctioned places, and accepts the current terms and privacy notice on first sign-in.

Each customer's account is a Privy embedded wallet, the same address on every EVM network, with gas paid by Privy. Money moves only with a passkey or authenticator app, and every action is checked on the server against feature switches, asset pauses, the account lock, the optional daily limit, and recipient rules. Chains and protocols decide balances and settlement; D1 holds replaceable projections, settings, consent, and audit evidence.

- **Deposit:** receive on Base, add from a connected wallet on Base, Ethereum, Arbitrum, Optimism, or Polygon through LI.FI, or buy USDC by card.
- **Send, Swap, Earn:** send or swap any asset in the registry, on Base or another network through LI.FI; Earn with Aave (USDC, WETH) and two Morpho USDC vaults on Base.
- **Assets:** only those in `apps/web/src/lib/assets/registry.ts`: ETH, USDC, EURC, WETH, cbBTC, ten Coinbase tokenized stocks on Base, and Tether Gold on Ethereum. Operators can pause any of them. See [supported assets](./docs/architecture/assets.md).
- **Not live:** Bridge bank transfers and Bridge + Stripe cards are built behind switches and wait for partner approval.

What each feature does and what's missing: [build status](./docs/overview/build-status.md). Customer view: [product status](./apps/docs/src/content/docs/getting-started/status.md).

## Layout

- `apps/web`: the customer app (vinext, Next.js App Router on Vite, deployed as a Worker). API handlers use the wrapper in `apps/web/src/lib/http/route.ts`; `tests/unit/api-route-inventory.test.ts` fails otherwise.
- `apps/events`: the queue consumer that applies signed provider events to D1 projections, using `packages/provider-projections`.
- `apps/ops`: the operations app, its own Worker behind Cloudflare Access.
- `apps/docs`: the public docs site (Astro Starlight).
- `infra/d1/migrations`: the D1 schema, `0001_baseline.sql` then numbered migrations (`0002_…`, `0003_…`), append-only.
- [`docs/`](./docs/README.md): internal docs (architecture, runbooks, security, compliance).

## Commands

```bash
pnpm install
pnpm dev                 # web app
pnpm ops:dev             # operations app, calling the web dev server
pnpm lint
pnpm typecheck:all       # every package, as CI runs it
pnpm test:unit
pnpm test:e2e            # builds, then Playwright desktop and mobile
pnpm build
pnpm marketing:check     # registered marketing claims
pnpm production:check    # what the production Worker config still lacks
```

`main` deploys only to the isolated [development Worker](./docs/operations/aura-development-worker.md). Production steps are in [production launch](./docs/operations/production-launch.md). Never put secrets in `wrangler.jsonc`; use `wrangler secret put`.
