# End-to-end tests

`pnpm test:e2e` runs Playwright on desktop and mobile Chromium against the web app in dev mode. Playwright starts `support/serve.mjs`, which:

1. starts `support/fake-edge.mjs`, a local stand-in for everything outside Aura:
   - Privy's API, and access tokens signed with a key it generates;
   - a JSON-RPC node for Base (8453) and Ethereum (1);
   - the Kraken price feed;
   - Cloudflare Access for the operations app: its published keys at `/access/cdn-cgi/access/certs`, and operator tokens from `/__access`;
   - Hyperliquid's `/info` API (markets, accounts, candles, the order book, fee rates) and Polymarket's Gamma, order-book, and data APIs (`support/fake-markets.mjs`), with a few markets, prices, and an empty account;
2. resets a separate local D1 (`.wrangler/e2e-state`) and applies the baseline schema;
3. starts `vinext dev` with `AURA_E2E=1`, which:
   - swaps Privy's browser SDK for `support/privy-react-fake.tsx`, and the saved-session check (`lib/client/privy-session.ts`) for `support/privy-session-fake.ts`, so a signed-in test loads the Privy runtime and a guest test doesn't until it signs in (see `vite.config.ts`);
   - points the Worker at the fake through `PRIVY_API_URL`, `PRIVY_VERIFICATION_KEY`, `RPC_URL_<chain>`, `KRAKEN_API_URL`, `HYPERLIQUID_API_URL`, the `POLYMARKET_*_URL`s, `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD`;
4. starts the operations app (`apps/ops`) with Vite on port 43175 (`AUREL_E2E_OPS_PORT`), forwarding its `/api` calls to the web app's `/api/ops`.

Aura's own code runs for real: the pages, the API routes, token verification, the chain reads, and D1. The overrides only take effect for loopback URLs (`src/lib/testing/local-edge.ts`), so they can't change a deployed Worker.

## Writing a test

Import `test` and `expect` from `support/fixtures.ts`. It forwards the browser's calls to the fake edge (`https://edge.aura-e2e.test`), so the app keeps its deployed Content Security Policy.

Use the helpers in `support/session.ts`:

- `newCustomer()` creates a Privy user with an embedded wallet, unique to the test, and mints their token.
- `setBalances(wallet, { 8453: { [ASSETS.usdc]: "1000000" } })` sets on-chain balances in raw units. `"native"` is ETH.
- `setIdentity(page, customer, { signedIn })` gives the browser that identity. Without `signedIn`, the test signs in with the page's button.
- `acceptTerms(page, customer)` records terms acceptance, as a returning customer already has.
- `edge("/__state", { down: ["rpc:1", "kraken", "privy"] })` makes an outside service fail.
- `edge("/__reset")` clears the fake between tests.
- `newCustomer({ connectedWallet: true })` also links a MetaMask-like wallet (`customer.externalWallets[0]`). It sends through the fake edge, which moves balances and keeps receipts like a chain. `edge("/__sent")` lists what it sent. `edge("/__state", { revertNext: true })` makes the next one revert.
- `edge("/__state", { bridge: { status: "DONE", substatus: "COMPLETED" } })` sets what LI.FI reports for a bridge (`PENDING`, `COMPLETED`, or `REFUNDED`).
- `edge("/__receive", { chainId, to, token, amount, from })` sends money to an address from outside Aura. The fake node answers Alchemy's `alchemy_getAssetTransfers` from its own transactions and logs, so it appears in Transactions; `down: ["transfers"]` makes that index fail.
- `setFeature(page, "cross_chain", true)` flips a feature switch through the real operations API, with an operator's Access token.
- `operatorHeaders({ email, audience, expiresIn, forged })` returns the `Cf-Access-Jwt-Assertion` header Access would add, for calling `/api/ops/*` as an operator, or with a wrong audience, an expired token, or a forged signature. `tests/e2e/ops.spec.ts` drives the operations app this way on desktop and mobile.
- `edge("/__markets", { perps: { positions: [perpPosition({ … })] }, predictions: { positions: [predictionPosition({ … })] } })` gives the customer's venue accounts positions, orders, or cash (see `support/fake-markets.mjs`); `down: ["hyperliquid", "polymarket"]` makes a venue fail. The fake reads venues but doesn't check venue signatures, so `markets.spec.ts` stubs the write routes (setup, signatures, trade) in the browser and checks what the page sends.
- `MARKETS_SCREENSHOTS=<folder>` makes `markets.spec.ts` save a desktop and phone screenshot of each Markets screen there, for design review.
- In the browser, `localStorage` `aura-e2e-wallet` = `reject` makes the connected wallet refuse, and `aura-e2e-card` = `fail` makes the card flow fail. Card payments are recorded in `window.__auraE2E.fundWallet`.

Each feature has one spec named after it, covering every step and failure listed in its pull request.

## What CI runs

A pull request runs only the specs for the features it changes, plus `sign-in-overview` as a smoke test. `scripts/e2e-select.mjs` maps changed paths to specs. Shared code (`lib/actions`, `lib/auth`, `lib/http`, the shell, `support/`, config, migrations, and any app file the map doesn't recognise) runs every spec. Run `node scripts/e2e-select.mjs` to see what your branch will run, and run the same specs locally with `pnpm test:e2e tests/e2e/<feature>.spec.ts`.

When you add a spec, add its feature and path words to `features` in `scripts/e2e-select.mjs`; `scripts/e2e-select.test.mjs` fails until you do.

The full suite runs every night on `main`, from the Actions tab (`workflow_dispatch`), and on a pull request labelled `full-e2e`, split with `--shard` into 4 jobs per browser. Each job has its own server and fake chain.

To rerun against a server that's already running, start `node tests/e2e/support/serve.mjs` and set `AUREL_E2E_USE_EXISTING=1`.
