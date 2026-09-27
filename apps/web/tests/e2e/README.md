# End-to-end tests

`pnpm test:e2e` runs Playwright on desktop and mobile Chromium against the web app in dev mode. Playwright starts `support/serve.mjs`, which:

1. starts `support/fake-edge.mjs`, a local stand-in for everything outside Aura:
   - Privy's API, and access tokens signed with a key it generates;
   - a JSON-RPC node for Base (8453) and Ethereum (1);
   - the Kraken price feed;
2. resets a separate local D1 (`.wrangler/e2e-state`) and applies the baseline schema;
3. starts `vinext dev` with `AURA_E2E=1`, which:
   - swaps Privy's browser SDK for `support/privy-react-fake.tsx` (see `vite.config.ts`);
   - points the Worker at the fake through `PRIVY_API_URL`, `PRIVY_VERIFICATION_KEY`, `RPC_URL_<chain>` and `KRAKEN_API_URL`.

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
- `setFeature(page, "cross_chain", true)` flips a feature switch through the real operations API, as the test operator.
- In the browser, `localStorage` `aura-e2e-wallet` = `reject` makes the connected wallet refuse, and `aura-e2e-card` = `fail` makes the card flow fail. Card payments are recorded in `window.__auraE2E.fundWallet`.

Each feature has one spec named after it, covering every step and failure listed in its pull request.

To rerun against a server that's already running, start `node tests/e2e/support/serve.mjs` and set `AUREL_E2E_USE_EXISTING=1`.
