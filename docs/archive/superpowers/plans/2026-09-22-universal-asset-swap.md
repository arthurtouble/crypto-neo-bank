# Universal Asset Swap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a customer search the live LI.FI token universe on supported chains and swap a validated, eligible pair through Aurel's controlled review and execution path.

**Architecture:** Normalize provider tokens to chain-scoped identities, then apply Aurel screening and ranking before selection. A provider-neutral quote result wraps LI.FI routes; execution consumes the immutable preparation and verification boundary delivered by program 1. Market price rows link to Swap only through an explicit canonical mapping, never by ticker.

**Tech Stack:** TypeScript, vinext/React, Cloudflare Workers and D1, LI.FI REST, Privy, wagmi/viem, Zod, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-aurel-product-parity-design.md` (program 2; shared authority and safety rules apply).

## Global Constraints

- Program 1 transaction evidence and execution safety must land first. Integrate its prepared action, owned-wallet, policy, step-up, simulation, hash binding, settlement verification, and dedicated Swap kill-switch APIs as implemented; do not create a second execution path.
- Chain contracts and contracted providers are authoritative for balances and settlement. D1 stores controls, audit evidence, and rebuildable projections; it is not an account ledger.
- Search visibility, quotability, execution permission, and legal eligibility are separate. A LI.FI token or quote is never proof of safety, verification, or regulatory eligibility.
- Keep regulated tokenized products on program 3's separate catalog and order path. Block known regulated/denied contracts even if LI.FI lists them.
- A server timer cannot sign or submit a customer wallet transaction. Every approval and swap requires explicit wallet confirmation.
- Supported chains are the five in `apps/web/src/config/chains.ts`: Base 8453, Ethereum 1, Arbitrum 42161, Optimism 10, Polygon 137. Adding chains needs a separate review.
- Use the existing Aurel design system, Satoshi body type, phthalo green `#123524`, light/dark themes, responsive layouts, keyboard focus, and reduced motion.
- No real-money QA. Production activation needs provider credentials, legal/country matrix, security review, runbook, and rollback via the Swap switch.

## Review Focus

- Two tokens named USDC on different chains: distinct IDs and balances; test in Tasks 1 and 5.
- An exact contract search with stale, denied, or malformed metadata: fail closed or show a clearly unavailable import state; test in Tasks 2 and 3.
- A quote that changes token, amount, chain, minimum, target, or approval spender: reject before a wallet prompt; test in Task 4.
- A source-chain gas shortage or failed approval during a cross-chain route: halt the swap and preserve truthful pending/failed status; test in Task 5.
- A Kraken ticker matching multiple contracts or no canonical mapping: no Swap deep link; test in Task 6.

## File Map and Interfaces

| File | Responsibility |
| --- | --- |
| `apps/web/src/lib/swap/assets.ts` (new) | Canonical IDs, metadata schema, trust/eligibility state, safe URL parsing. |
| `apps/web/src/lib/swap/catalog.ts` (new) | LI.FI token-list adapter, validation, bounded cache, search/rank/filter, explicit contract import. |
| `apps/web/src/app/api/swap/assets/route.ts` (new) | Authenticated, rate-limited paged search and import endpoint. |
| `apps/web/src/lib/swap/quotes.ts` (new) | Provider-neutral `QuoteAdapter` and quote envelope; LI.FI is first adapter. |
| `apps/web/src/lib/swap/lifi.ts` (modify) | LI.FI quote request and strict normalized plan validation. |
| `apps/web/src/app/api/swap/quote/route.ts` (modify) | Resolve current catalog and screening state, owned wallet, feature switches, then quote. |
| `apps/web/src/components/swap-asset-picker.tsx` (new) | Accessible search, identity labels, risk acknowledgement and import UI. |
| `apps/web/src/components/swap-workspace.tsx` (modify) | Amount-first Swap flow, live review, network/gas checks, and program 1 execution handoff. |
| `apps/web/src/app/product-system.css` (modify) | Picker/review styles in existing design system. |
| `apps/web/src/lib/markets/swap-links.ts` (new) | Explicit Kraken market ID to canonical token ID mapping. |
| `apps/web/src/components/market-explorer.tsx` (modify) | Canonical deep links and view-only states. |
| `apps/web/src/config/swap-assets.ts` (retire after migration) | Remove ticker/enum coupling when all callers move. |
| `apps/docs/src/content/docs/product/swaps.md` (modify) | Explain live catalog, eligibility distinctions, review, and execution evidence. |

Do not put favorites or recents in a shared server cache. Use customer-scoped state (local storage initially) keyed by canonical ID, with invalid/stale IDs ignored. Held ranking may use only authoritative wallet balance reads; a missing read is not a zero balance. No new D1 table is needed for this tranche unless program 1's evidence schema requires it.

### Task 1: Canonical asset identity and supported-chain contract

**Files:** Create `apps/web/src/lib/swap/assets.ts`; test `apps/web/tests/unit/swap-assets.test.ts`; modify existing `apps/web/src/config/swap-assets.ts` only after downstream migration.

**Interfaces:** Produce `type AssetId = string`, `type CatalogAsset = { id: AssetId; chainId: number; address: string | null; symbol: string; name: string; decimals: number; logoUrl: string | null; verification: "verified" | "unverified"; eligibility: "eligible" | "unavailable"; unavailableReason?: string }`, `assetId(chainId, address): AssetId`, `parseAssetId(value): { chainId: number; address: string | null } | null`, and `sameAsset(a,b): boolean`. Native ID format is `<chainId>:native`; ERC-20 is `<chainId>:<lowercase-0x-address>`. A provider's native sentinel is normalized to `null` at the adapter boundary.

```ts
const baseUsdc = assetId(8453, "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913");
// "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"
const baseEth = assetId(8453, null); // "8453:native"
```

- [ ] **Step 1: Write failing tests** for address-case collapse, chain separation, native separation, checksum/length rejection, and rejecting unsupported chain IDs. Example: `expect(assetId(8453, USDC)).toBe("8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")`; `expect(assetId(1, USDC)).not.toBe(assetId(8453, USDC))`; `expect(parseAssetId("8453:javascript:alert(1)")).toBeNull()`.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/swap-assets.test.ts`; expect failure because the module is absent.
- [ ] **Step 3: Implement** IDs with `SUPPORTED_CHAINS`, `viem` address validation, lowercasing, and Zod bounds (`symbol` 1–32, `name` 1–120, `decimals` integer 0–36). Never infer an address from a ticker. Add URL parsing that accepts only canonical IDs.
- [ ] **Step 4: Rerun** the focused test and `pnpm typecheck`; expect pass. Commit this task's files.

### Task 2: Live LI.FI catalog adapter and screening

**Files:** Create `apps/web/src/lib/swap/catalog.ts`, `apps/web/tests/unit/swap-catalog.test.ts`.

**Interfaces:** Produce `getCatalogPage(input: { query: string; cursor?: string; chainIds: readonly number[] }, dependencies?: { fetcher: typeof fetch }): Promise<{ assets: CatalogAsset[]; nextCursor: string | null; observedAt: string; source: "LI.FI" }>` and `resolveCatalogAsset(id: AssetId): Promise<CatalogAsset | null>`. Search full supported catalog server side, not just the first provider page. Implement a bounded per-chain LI.FI token-list snapshot with TTL and stale-data failure; do not download the full list on every keystroke. Bind each pagination cursor to the snapshot version so a refresh cannot silently skip or repeat assets. Resolve an exact contract import against live LI.FI support and Aurel screening before exposing it as selectable. Define screening in this module as `screenAsset(asset): "denied" | "verified" | "unverified" | "regulated"`; use a reviewed deny/regulated registry and explicit trusted registry, never LI.FI's inclusion alone. Keep the source lists reviewable and testable.

```ts
const page = await getCatalogPage({ query: "USDC", chainIds: [8453, 1] });
expect(page.assets.some((asset) => asset.id === "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913")).toBe(true);
expect(page.assets.every((asset) => asset.eligibility === "eligible")).toBe(true);
```

- [ ] **Step 1: Write failing tests** with fixture pages: duplicate address case collapses; symbol collisions remain separate; malformed chain/address/decimals are dropped; denied and regulated entries are absent; verified/popular ranking never removes a lower-ranked eligible result; a cursor from an old snapshot is rejected; provider timeout and expired snapshot return an unavailable error; exact contract import of an unsupported token is rejected.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/swap-catalog.test.ts`; expect failure.
- [ ] **Step 3: Implement** the LI.FI `/v1/tokens` fetch using `LIFI_API_KEY` when present, 12-second timeout, response schema validation, per-chain supported-chain filtering, a bounded cache, and stable pagination. Normalize provider native-address conventions at this boundary. Return only metadata, never provider transaction requests. Make search name, symbol, and exact address case insensitive; rank exact address before symbol and name, then verified/popular while retaining complete results. Let the client add held/favorite/recent ranking to returned pages without treating a missing balance as zero. Favor a small batch/page size and a maximum query length of 120.
- [ ] **Step 4: Rerun** the focused test and `pnpm typecheck`; expect pass. Commit this task's files.

### Task 3: Asset search API and import contract

**Files:** Create `apps/web/src/app/api/swap/assets/route.ts`, `apps/web/tests/unit/swap-assets-route.test.ts`.

**Interfaces:** `GET /api/swap/assets?q=<text>&cursor=<opaque>&chainIds=8453,1` returns `{ assets, nextCursor, observedAt, source }`; `GET /api/swap/assets?import=<chainId>:<address>` returns one screened asset or a typed `unsupported_asset`/`asset_unavailable` error. The import response must identify `verification: "unverified"` unless the reviewed registry verifies it. This endpoint never grants quote or execution permission.

```ts
const response = await GET(new Request("https://aurel.test/api/swap/assets?q=USDC&chainIds=8453"));
expect(response.headers.get("Cache-Control")).toBe("no-store");
expect((await response.json()).assets[0].id).toMatch(/^8453:/);
```

- [ ] **Step 1: Write failing route tests** for unauthenticated request (401), beta denial (403), bad query/cursor/chain (400), rate limit (429), denied or regulated address (404), provider outage (503), and `Cache-Control: no-store` for customer-ranked results. Mock the catalog and auth dependencies using the project's Vitest pattern.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/swap-assets-route.test.ts`; expect failure.
- [ ] **Step 3: Implement** `requireVerifiedSubject`, `requireBetaAccess`, `enforceRateLimit`, Zod query parsing, and typed errors. Keep server returned visibility separate from later quoteability. Avoid reflecting arbitrary provider errors or unsafe metadata directly into UI copy.
- [ ] **Step 4: Rerun** route tests and `pnpm typecheck`; expect pass. Commit this task's files.

### Task 4: Provider-neutral quote adapter and strict route validation

**Files:** Create `apps/web/src/lib/swap/quotes.ts`; modify `apps/web/src/lib/swap/lifi.ts`, `apps/web/src/app/api/swap/quote/route.ts`, `apps/web/tests/unit/swap-routing.test.ts`; add `apps/web/tests/unit/swap-quote-route.test.ts`.

**Interfaces:** Replace enum request with `SwapQuoteInput = { fromAssetId: AssetId; toAssetId: AssetId; amount: string; fromAddress: string; slippageBps: number; unverifiedAcknowledgements?: AssetId[] }`. `QuoteAdapter.quote(input, assets): Promise<ValidatedSwapQuote[]>` returns `provider`, `quoteId`, canonical source/destination IDs, chain IDs, raw input/output/minimum, expiry, fees, price impact when observed, approval target, execution plan reference, and `routeKind: "same_chain" | "cross_chain"`. LI.FI implements the adapter; adding Socket/0x later must pass the same validation contract. Only program 1's preparation endpoint can turn the validated unsigned plan into an executable action.

```ts
type ValidatedSwapQuote = {
  provider: string; quoteId: string; fromAssetId: AssetId; toAssetId: AssetId;
  fromChainId: number; toChainId: number; fromAmountRaw: string;
  toAmountRaw: string; toAmountMinRaw: string; expiresAt: string;
  networkFeeUsd: number | null; priceImpactPercent: number | null;
  approvalTarget: string | null; planReference: string;
  routeKind: "same_chain" | "cross_chain";
};
interface QuoteAdapter {
  quote(input: SwapQuoteInput, assets: { from: CatalogAsset; to: CatalogAsset }): Promise<ValidatedSwapQuote[]>;
}
expect(validated.fromAssetId).toBe(input.fromAssetId);
expect(validated.fromAmountRaw).toBe(parseUnits(input.amount, assets.from.decimals).toString());
```

- [ ] **Step 1: Extend failing unit tests** for request precision based on actual token decimals; exact identity and raw input amount; positive output and minimum no greater than output; source-chain transaction chain, target, value and calldata; spender/target allowlists from program 1; unsupported chain; stale response; extreme price impact; missing fee/price data labeled unavailable. Include same-chain and cross-chain fixtures. Add route tests proving `swap_enabled` and `cross_chain` switches, owned-wallet check, current screening, and unverified acknowledgement are enforced before quote.
- [ ] **Step 2: Run** the two focused Vitest files; expect the new cases to fail.
- [ ] **Step 3: Implement** `QuoteAdapter` with LI.FI first. Resolve both IDs from the current screened catalog, reject denied/regulated/unavailable entries, recheck eligibility at quote time, and require exact unverified acknowledgement plus tighter price-impact/slippage bounds; if price impact cannot be established for an unverified asset, withhold its quote. Validate every quote independently; discard a bad route, but return 503 if no validated route survives. Replace the current four-exchange hardcoding with program 1's audited route/target policy; do not accept arbitrary LI.FI tools or spenders. Do not trust client-supplied decimals, verification status, wallet ownership, or target. Expose precise typed errors (`unsupported_chain`, `asset_unavailable`, `acknowledgement_required`, `no_live_route`, `quote_unavailable`) and `Cache-Control: no-store`. Preserve provider references and immutable raw values for program 1 preparation.
- [ ] **Step 4: Rerun** focused tests, `pnpm typecheck`, and `pnpm lint`; expect pass. Commit this task's files.

### Task 5: Searchable picker and secure Swap review

**Files:** Create `apps/web/src/components/swap-asset-picker.tsx`; modify `apps/web/src/components/swap-workspace.tsx`, `apps/web/src/app/product-system.css`; add `apps/web/tests/e2e/swap-catalog.spec.ts` and focused component tests if the existing harness supports them.

**Interfaces:** Picker props: `{ value: AssetId | null; onSelect(id: AssetId): void; excludedId?: AssetId; label: string }`. Swap uses canonical `fromAssetId`/`toAssetId`, authenticates search and quote requests, and sends a selected `quoteId` to program 1's preparation API. Program 1 returns the exact prepared approval/swap actions with expiry; the client uses those actions and records submitted hashes through its binding API. No raw `transactionRequest` from `/api/swap/quote` may be handed directly to `sendTransaction`.

```tsx
<SwapAssetPicker value={fromAssetId} excludedId={toAssetId} label="You Pay" onSelect={setFromAssetId} />
<SwapAssetPicker value={toAssetId} excludedId={fromAssetId} label="You Receive" onSelect={setToAssetId} />
```

- [ ] **Step 1: Write failing UI flow tests** for name/symbol/address search; same-symbol tokens on different chains; keyboard open/filter/arrows/Enter/Escape/focus return; mobile dialog; no results/provider outage; explicit contract import warning; unverified acknowledgement reset on asset change; stale quote invalidation when amount, pair, wallet, network, or slippage changes; cross-chain route explanation; insufficient source asset or native gas; approval cancellation/failure; pending destination settlement. Stub provider and wallet responses; never send a real transaction.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec playwright test tests/e2e/swap-catalog.spec.ts`; expect failing flows.
- [ ] **Step 3: Implement** a native Aurel dialog/listbox picker with selected asset name, symbol, network, and abbreviated contract. Rank held/favorite/recent without hiding other results. Read balances on each token's chain with wagmi/viem, with `unknown` distinct from zero. Put amount and minimum received first. In review disclose network changes, fees, exact approval amount/spender, slippage, price impact, route, quote age and unavailable values; use familiar Swap labels and existing theme tokens. Cross-chain destination is the owned wallet and is explained before confirmation.
- [ ] **Step 4: Connect** the execution button to program 1 preparation, policy, fresh step-up, approval simulation and confirmation, quote expiry recheck after approval, swap simulation and confirmation, submitted-hash binding, and settlement status polling. The button stays disabled when any required evidence is missing; pending, partial, replaced, reorged, and failed states use program 1's lifecycle. If program 1 API signatures differ, adapt this client to those actual signatures without weakening the sequence.
- [ ] **Step 5: Rerun** the focused browser tests at desktop/mobile viewports, keyboard and reduced-motion checks, `pnpm typecheck`, and `pnpm lint`; expect pass. Commit this task's files.

### Task 6: Canonical Markets navigation

**Files:** Create `apps/web/src/lib/markets/swap-links.ts`; modify `apps/web/src/components/market-explorer.tsx`, `apps/web/tests/unit/market-swap-navigation.test.ts`; retire `marketSwapAssetId` and `resolveSwapSelection` from `apps/web/src/config/swap-assets.ts` after callers move.

**Interfaces:** `marketSwapAssetId(market: Pick<MarketRow, "id" | "symbol">): AssetId | null` reads an explicit, reviewed mapping from Kraken market ID to a canonical asset ID. A link may preselect a token; Swap still resolves current catalog status and requires a live quote before actionable review. Market Explorer must resolve current screened catalog status before rendering the action; if an asset becomes denied/unavailable, the market stays view-only.

```ts
expect(marketSwapAssetId({ id: "eth-usd", symbol: "eth" })).toBe("8453:native");
expect(marketSwapAssetId({ id: "lookalike-usd", symbol: "eth" })).toBeNull();
```

- [ ] **Step 1: Replace failing tests** with Kraken ID fixtures for mapped ETH/USDC/LINK, BTC without an approved contract, lookalike ticker, ambiguous symbol, and malformed deep-link ID. Assert no ticker-only fallback and no clickable Swap action for unmapped rows.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web exec vitest run tests/unit/market-swap-navigation.test.ts`; expect failure.
- [ ] **Step 3: Implement** the explicit mapping, URI-encoded canonical `to` parameter, safe deep-link parser, and view-only copy. Preserve the distinction between Kraken price authority and LI.FI route authority; do not label market price as an executable quote.
- [ ] **Step 4: Rerun** focused tests and `pnpm typecheck`; expect pass. Commit this task's files.

### Task 7: Documentation, release evidence, and kill-switch drill

**Files:** Modify `apps/docs/src/content/docs/product/swaps.md`; update `apps/web/tests/e2e/product.spec.ts` only for assertions affected by the new UI.

- [ ] **Step 1: Update docs** with supported-chain scope, canonical identity, verified/unverified/import distinction, route-based availability, review fields, cross-chain settlement/pending behavior, explicit approvals, and program 1 evidence path. Remove the obsolete twelve-token allowlist and ticker-navigation claims.
- [ ] **Step 2: Run** `pnpm test:unit`, `pnpm test:e2e`, `pnpm typecheck`, `pnpm lint`, and `pnpm docs:build`. Verify search and quote errors, dark/light mobile layouts, keyboard and reduced-motion behavior, and the Swap switch blocking quote/preparation while leaving read-only markets truthful. Record results in the task handoff.
- [ ] **Step 3: Perform a read-only production smoke** of catalog search and quote error handling with no wallet submission. Release only after the program 1 security review, provider credential/country/legal gates, operational runbook, and rollback switch are signed off. Commit docs and any necessary test adjustment.

## Dependency and acceptance gate

The program 1 branch must expose a reviewed and tested owned-wallet assertion, `swap_enabled` switch, immutable preparation API, submitted-hash binding, policy/step-up/simulation sequence, approval evidence, and independently verified settlement states. Treat missing pieces as a failed integration gate. Program 2 does not change the program 3 regulated-market gate, route execution engines, D1 balance authority, or server-side signing. An asset is selectable when screened catalog metadata is current; it is actionable only after a validated live route and successful preparation. The release demonstration must show a same-chain route, a cross-chain route, an unsupported asset, an unverified import, and a stale or failed route without real money.
