# Authoritative Historical Portfolio Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the modeled portfolio chart with historical quantities, independent observed prices, explicit coverage gaps, time weighted returns, and versioned cost basis support.

**Architecture:** Chain and provider adapters page through source history and normalize observations with source provenance and block finality. D1 stores disposable event, price, daily quantity, and calculation projections plus source cursors; calculation code refuses to value or join incomplete days. A separate authenticated read path serves the dashboard and tax support, while current Aave supply and debt are reconciled to live source reads.

**Tech Stack:** vinext/Next route handlers on Cloudflare Workers, D1, TypeScript, viem, Zod, Vitest, Playwright, Privy, Kraken market data adapter.

**Spec:** `docs/superpowers/specs/2026-09-22-aurel-product-parity-design.md`, program 4 and shared authority rules.

## Global Constraints

- Chain contracts and contracted providers are authoritative for balances, positions, settlement, entitlements, and regulated eligibility. Market data sources are authoritative only for their observed prices. D1 is never an account ledger.
- An observation without identity, source history, finality, or price evidence is unavailable or review required. An incomplete interval is a gap, never a line segment or interpolated value.
- Preserve transfers between owned accounts, contributions, withdrawals, swaps, rewards, fees, wrapped assets, liabilities, and position receipts as distinct semantic classes.
- Cost basis and gains are versioned tax support, not tax advice. Unsupported classifications remain `review_required`.
- The Aurel design system, Satoshi body type, phthalo green `#123524`, light and dark themes, responsive layout, keyboard focus, and reduced motion apply to UI work.
- No real money action is used for QA. Release requires local tests, desktop/mobile and keyboard checks, production smoke checks, and a rebuild drill that preserves customer controls and audit evidence.

## Dependencies and scope boundary

- Program 1 transaction evidence is a prerequisite for treating Aurel intent records as verified settlement. Until its receipt/effect verification exists, use intents only as a *hint* for classification; never synthesize holdings or realized gains from `transaction_intents`. Existing `confirmed` rows retain their weaker provenance.
- Program 2 supplies canonical token identity (`chainId:lowercase contract`, with a chain scoped native ID). If it has not landed, define the same ID in this tranche and use an adapter when the catalog arrives; never key by ticker.
- Program 5 will extend protocol adapters. This tranche supplies **current Base Aave V3 supply and debt legs** from source reads and historical protocol events where Aave gives sufficient evidence. It does not activate other protocols or claims.
- A paginated indexer with native transfers, token transfers, transaction receipts and block hashes is required for complete chain history. The Base adapter uses Blockscout Pro's address transactions, internal transactions, and token transfers endpoints ([official API overview](https://www.blog.blockscout.com/build-a-multichain-wallet-portfolio-tracker-with-blockscout-pro-api/)); verify the exact response fields and rate contract against its current API reference during implementation. If credentials, page continuity, or a source endpoint are unavailable, keep the affected dates incomplete. Public RPC alone cannot enumerate a wallet's full native transfer history.
- Do not repurpose `wallet_references` as proof of linked ownership: `apps/web/src/app/api/intents/evaluate/route.ts` currently inserts rows from an unverified request address. Include only wallets returned by a server-side Privy read of the authenticated user's linked accounts; retain the provider wallet ID and account type as proof provenance. If a connected external wallet is absent from that server response, show it only in the existing live read-only wallet view, outside persisted historical totals.

## File map and interfaces

| File | Responsibility |
| --- | --- |
| `infra/d1/migrations/0014_portfolio_analytics.sql` | New disposable event, coverage, price, daily quantity and calculation tables. Keep `wallet_references`, controls, intents, and audit tables untouched. Confirm the next migration number at implementation time. |
| `apps/web/src/lib/portfolio/types.ts` | Canonical IDs, event/price/coverage/read DTOs and source interfaces. |
| `apps/web/src/lib/portfolio/accounts.ts` | Resolve subject-owned Privy wallets and explicitly linked read-only wallets; return account scope and proof provenance. |
| `apps/web/src/lib/portfolio/chain-source.ts` | Paginated chain indexer adapter; validate page cursors, source IDs, block/receipt evidence, and finality against chain RPC. |
| `apps/web/src/lib/portfolio/aave-source.ts` | Paginated Base Aave activity and current supply/debt legs with source completeness. |
| `apps/web/src/lib/portfolio/normalize.ts` | One economic event per source effect; semantic classification, internal transfers, wrappers, receipt suppression, deduplication. |
| `apps/web/src/lib/portfolio/ingest.ts` | Bounded idempotent page runner, source checkpoints, reorg invalidation, and retry logic. |
| `apps/web/src/lib/portfolio/prices.ts` | Independent historical USD observations keyed by canonical asset and UTC day; no inferred peg or price carry-forward. |
| `apps/web/src/lib/portfolio/calculate.ts` | Exact-unit daily balances, coverage, USD value, time weighted return and versioned basis/gains. |
| `apps/web/src/lib/portfolio/store.ts` | D1 read/write and rebuild transactions for analytics only. |
| `apps/web/src/app/api/portfolio/refresh/route.ts` | Authenticated, rate-limited one-page refresh with opaque resume cursor. |
| `apps/web/src/app/api/portfolio/history/route.ts` | Authenticated range read; quantities, values, gaps, return and coverage. |
| `apps/web/src/app/api/portfolio/tax-support/route.ts` | Authenticated versioned lots/gains export, including review-required rows and source IDs. |
| `apps/web/src/components/portfolio-performance.tsx` | Chart and value UI from portfolio history, with disconnected paths across gaps. |
| `apps/web/src/components/dashboard.tsx` | Pass authenticated subject context; stop passing today's USDC/ETH as historical holdings. |
| `apps/web/src/components/activity-workspace.tsx`, `apps/web/src/lib/activity/presentation.ts` | Label current activity export as a capped view; direct historical tax support to the new complete/coverage-aware endpoint. |
| `apps/web/src/app/product-system.css` | Responsive gap/legend/coverage styles using existing tokens. |
| `apps/web/tests/unit/portfolio-*.test.ts`, `apps/web/tests/e2e/product.spec.ts`, `scripts/recovery-drill.sh` | Focused decision tests, routes, responsive/keyboard checks, and analytics-only rebuild drill. |

Core signatures to keep consistent:

```ts
type AssetId = `${number}:native` | `${number}:0x${string}`; // lowercase canonical address
type AccountId = `${number}:0x${string}`; // chain and lowercase wallet address
type EventKind = "contribution" | "withdrawal" | "internal_transfer" | "swap" | "reward" | "fee" | "wrap" | "unwrap" | "supply" | "redeem" | "borrow" | "repay" | "liquidation" | "unknown";
type Completeness = "complete" | "partial" | "unavailable" | "unfinalized";
type HistoricalEvent = { sourceId: string; sourceName: string; sourceEventId: string; ingestionVersion: number; accountId: AccountId; assetId: AssetId; rawDelta: string; decimals: number; kind: EventKind; occurredAt: string; chainId: number | null; blockNumber: string | null; blockHash: string | null; txHash: string | null; logIndex: number | null; finality: "finalized" | "pending" | "reorged"; completeness: Completeness; groupId: string | null; counterpartyAccountId: AccountId | null; evidenceJson: string };
type HistoryPage = { events: HistoricalEvent[]; nextCursor: string | null; coveredThrough: string; complete: boolean; sourceId: string };
interface HistoricalEventSource { readonly sourceId: string; page(input: { accountId: AccountId; cursor: string | null; from: string; through: string; limit: number }): Promise<HistoryPage> }
type PriceObservation = { assetId: AssetId; day: string; usd: string; sourceId: string; observedAt: string; methodology: string; version: number };
type DayCoverage = { day: string; accountId: AccountId; sourceId: string; eventStatus: Completeness; priceStatus: Completeness; reason: string | null };
type HistoryPoint = { day: string; netValueUsd: string | null; twrIndex: string | null; status: Completeness; reasons: string[] };
type PortfolioHistory = { calculationVersion: number; points: HistoryPoint[]; currentAave: { suppliedUsd: string | null; debtUsd: string | null; status: Completeness }; externalWallets: AccountId[]; coverage: DayCoverage[]; observedAt: string };
```

Use decimal strings and `bigint` arithmetic for raw units and explicit decimal scaling. `Number` is only allowed at the final chart coordinate/formatting boundary after a finite-range check. A single source event may create several legs, each with a stable `sourceEventId:leg` identity. `sourceId` names the contracted/indexed source; `sourceEventId` is its immutable record key.

## Review Focus

1. A source silently truncates a page or repeats a cursor: leave the interval partial and do not advance the complete watermark (Task 2 test).
2. A reorg changes a block hash after a previously complete day: invalidate affected events, prices unaffected, and derived days until replay (Task 4 test).
3. An internal transfer arrives from one owned wallet before the other: do not count it as a contribution or realize a gain while coverage is partial (Task 3 test).
4. An asset has a quantity but no independent USD price for a day: that day has `netValueUsd: null`, no TWR point, and a visible gap (Tasks 5 and 6 tests).
5. A reward, debt receipt, or unknown transaction cannot be classified for tax: retain its source evidence and mark `review_required`; do not invent cost basis (Task 5 test).

---

### Task 1: Disposable analytics schema and account scope

**Files:** Create `infra/d1/migrations/0014_portfolio_analytics.sql`, `apps/web/src/lib/portfolio/types.ts`, `apps/web/src/lib/portfolio/accounts.ts`; test `apps/web/tests/unit/portfolio-schema.test.ts`, `apps/web/tests/unit/portfolio-accounts.test.ts`; modify `scripts/recovery-drill.sh`.

**Interfaces:** Consume `requireVerifiedSubject(request): Promise<VerifiedSubject>` and a server-side Privy read of that subject's linked wallets; produce `resolvePortfolioAccounts(subjectReference): Promise<Array<{ accountId: AccountId; origin: "embedded" | "linked_external"; proofReference: string; linkedAt: string }>>`. Keep linked external wallets separately tagged. An address supplied in a query string never grants scope.

- [ ] **Step 1: Write failing account and migration tests.** Use a fixture with subject A's embedded wallet, subject A's proof-linked external wallet, and subject B's wallet. Assert A resolves two accounts, `external` is tagged, and a `wallet_references` row inserted by intent evaluation alone does not resolve. In the migration test, apply all SQL migrations to fresh local D1 and assert the new analytics tables exist; seed `security_profiles`, `consent_evidence`, `audit_events`, and an intent before dropping only the new analytics tables, then assert those four durable tables retain rows.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web test:unit -- portfolio-schema portfolio-accounts`; expect failure because modules and migration are absent.
- [ ] **Step 3: Add schema.** Create `portfolio_events` keyed by `(subject_reference, source_id, source_event_id, ingestion_version, leg_index)` with account/asset IDs, raw delta, decimals, kind, chain/block/hash/tx/log, finality, group/counterparty, evidence hash/JSON, observed time and completeness. Create `portfolio_source_checkpoints` keyed by `(subject_reference, account_id, source_id)` with cursor, covered-from/through, last finalized block/hash, ingestion version, status, reason and updated time. Create `portfolio_price_observations` keyed by `(asset_id, day, source_id, version)` with USD decimal string, methodology, observed time. Create `portfolio_daily_quantities` keyed by `(subject_reference, account_id, asset_id, day, calculation_version)` with raw closing quantity and status. Create `portfolio_daily_results` keyed by `(subject_reference, day, calculation_version)` with nullable USD value, nullable TWR index, coverage JSON/status. Create `portfolio_lots` and `portfolio_disposals` keyed by subject, account, asset, source-event identity, calculation version, with raw units, USD basis/proceeds nullable, classification and evidence. Index every subject/day read and source/block invalidation path. Include `CHECK`s for finality, status, decimals 0–36 and canonical IDs. Never add a balance column to durable account/control tables.
- [ ] **Step 4: Implement account scope.** Resolve embedded and externally linked wallets from a fresh server-side Privy user read, matching the verified `subjectReference`. Store the provider wallet ID as `proofReference`; classify Privy embedded versus linked external from its wallet type. Omit any address not in this response, even if it appears in `wallet_references` or the browser's `useWallets()` list. Recheck links on every refresh/read; when a link disappears, exclude that account and invalidate its aggregate projections. Lowercase IDs and reject unsupported chain IDs. Test that unlinking an external wallet removes it from the next read.
- [ ] **Step 5: Run** the focused tests and `pnpm typecheck`; expect pass. Add an analytics table wipe/recreate branch to `scripts/recovery-drill.sh`, preserving durable controls. Commit this task.

### Task 2: Paginated source adapters with finality and coverage

**Files:** Create `apps/web/src/lib/portfolio/chain-source.ts`, `apps/web/src/lib/portfolio/aave-source.ts`; modify `apps/web/src/lib/defi/aave.ts`; test `apps/web/tests/unit/portfolio-sources.test.ts`.

**Interfaces:** Produce `HistoricalEventSource.page(...)` above and `readCurrentAaveLegs(accountId): Promise<{ legs: Array<{ assetId: AssetId; side: "supply" | "debt"; rawUnits: string; decimals: number; market: string; observedAt: string; sourceId: string }>; status: Completeness; reason: string | null }>`.

- [ ] **Step 1: Write failing source tests** for two pages with an opaque continuation cursor, an empty terminal page, duplicate source IDs across pages, missing native transfer page, repeated cursor, malformed `rawDelta`, unfinalized block, and changed block hash. Assert only an explicit terminal page with continuous coverage returns `complete`; a provider `partial` flag or missing receipt/hash returns `partial`. Test Aave supply and debt as two separately signed legs, and a response lacking either required leg marked partial rather than zero.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web test:unit -- portfolio-sources`; expect failures.
- [ ] **Step 3: Implement Base chain source** using `https://api.blockscout.com/8453/api/v2/addresses/{address}/transactions`, `/internal-transactions`, and `/token-transfers`, with each endpoint's `next_page_params` tracked independently in the opaque cursor. Add `BLOCKSCOUT_API_KEY` as a server secret in `apps/web/wrangler.jsonc` and deployment documentation. Normalize each source ID using chain/tx/log/trace indices. Verify block hash and receipt status through viem RPC before finalizing. A configurable confirmation depth is required; all three terminal pages must reach the same covered-through watermark. Reject cursor loops and contradictory page metadata. Retain provider payload digest, not sensitive full payload. No coverage claim if native or internal transfers are unavailable. Return `unavailable` for unconfigured chains.
- [ ] **Step 4: Implement Aave source** using `get_user_activity` page cursors only if the upstream response proves a next cursor and completion, and `get_user_positions`/`get_user_summary` for current Base legs. Validate governed market `AAVE_BASE_V3_MARKET`; derive reserve asset ID from contract address, not symbol. Preserve both supply and debt, source time and completeness. Do not use `normalizeAavePosition()`'s aggregate `netWorthUsd` as a historical leg or add receipt tokens alongside underlying supply.
- [ ] **Step 5: Run** focused tests, `pnpm typecheck`, and `pnpm lint`; expect pass. Commit this task.

### Task 3: Economic event normalization and exact quantities

**Files:** Create `apps/web/src/lib/portfolio/normalize.ts`; test `apps/web/tests/unit/portfolio-normalize.test.ts`.

**Interfaces:** Produce `normalizeEconomicEvents(events: HistoricalEvent[], ownedAccounts: Set<AccountId>): { events: HistoricalEvent[]; unresolved: Array<{ sourceEventId: string; reason: string }> }` and `foldDailyQuantities(events: HistoricalEvent[], opening: Map<string, bigint>): Map<string, bigint>`.

- [ ] **Step 1: Write failing tests** using exact raw-unit fixtures for USDC (6 decimals), ETH/WETH (18), two-wallet internal transfer, external contribution/withdrawal, swap with input/output/fee, reward, wrap/unwrap, Aave supply/receipt, borrow/debt and repayment. Assert same-tx internal legs net to zero at aggregate scope; fees reduce value; receipt tokens are excluded from net asset value; borrow adds a liquid asset and matching liability; unmatched owned-side transfers remain `unknown`/partial until opposite-side coverage is complete. Test reordered and duplicated pages yield identical quantities.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web test:unit -- portfolio-normalize`; expect failures.
- [ ] **Step 3: Implement** deterministic grouping by chain/tx/source effect and owned-account set, stable classification without ticker matching, `bigint` arithmetic, token-decimal consistency checks and no sign inference from display labels. Track liabilities as negative legs and position receipts as non-valued references. If classification depends on missing counterparty, router output, or provider evidence, preserve the raw event as `unknown` with `review_required` semantics.
- [ ] **Step 4: Run** focused tests and `pnpm typecheck`; expect pass. Commit this task.

### Task 4: Idempotent ingestion, reorgs, and rebuild

**Files:** Create `apps/web/src/lib/portfolio/ingest.ts`, `apps/web/src/lib/portfolio/store.ts`, `apps/web/src/app/api/portfolio/refresh/route.ts`; test `apps/web/tests/unit/portfolio-ingest.test.ts`, `apps/web/tests/unit/portfolio-refresh-route.test.ts`.

**Interfaces:** Produce `ingestOnePage(db: D1Database, subjectReference: string, accountId: AccountId, source: HistoricalEventSource, cursor: string | null): Promise<{ nextCursor: string | null; status: Completeness; coveredThrough: string | null }>` and `invalidateFromBlock(db, subjectReference, chainId, blockNumber): Promise<void>`. Route accepts `{ accountId, sourceId, cursor? }`, reads account scope server-side, returns status/nextCursor/coverage; no client-selected arbitrary address or URL.

- [ ] **Step 1: Write failing tests** for replay of the same page (one stored effect), crash before checkpoint (safe retry), page with repeated cursor (checkpoint unchanged), unauthorized wallet (403), missing session (401), provider outage (503 with prior coverage preserved), source rate limit, and block hash change after a completed day (events and daily calculations from that block invalidated, source replay queued). Assert customer controls/audit rows remain intact after `rebuildPortfolioAnalytics(subject)`.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web test:unit -- portfolio-ingest portfolio-refresh-route`; expect failures.
- [ ] **Step 3: Implement** one-page bounded work (100 effects maximum, one account/source per call), deterministic upsert and checkpoint advance in one D1 transaction, cursor/version validation, and a server-issued opaque resume token bound to subject/account/source. Authenticate with `requireVerifiedSubject`, enforce a dedicated rate limit, and avoid public-cache headers. On reorg, mark affected observations `reorged`, rewind checkpoint to the last verified block, remove derived rows at and after the affected UTC day, and replay. Rebuild deletes subject-scoped `portfolio_events`, `portfolio_source_checkpoints`, `portfolio_daily_quantities`, `portfolio_daily_results`, `portfolio_lots`, and `portfolio_disposals` only; shared price observations are re-used or independently refreshed. No delete touches `transaction_intents`, `wallet_references`, `security_profiles`, `audit_events` or consent tables.
- [ ] **Step 4: Run** focused tests, `pnpm typecheck`, `pnpm lint`; expect pass. Commit this task.

### Task 5: Independent prices, daily valuation, TWR and basis

**Files:** Create `apps/web/src/lib/portfolio/prices.ts`, `apps/web/src/lib/portfolio/calculate.ts`; test `apps/web/tests/unit/portfolio-prices.test.ts`, `apps/web/tests/unit/portfolio-calculate.test.ts`.

**Interfaces:** Produce `loadObservedUsdPrices(assetIds: AssetId[], days: string[]): Promise<PriceObservation[]>` and `calculatePortfolioDays(input: { events: HistoricalEvent[]; prices: PriceObservation[]; coverage: DayCoverage[]; calculationVersion: number }): { points: HistoryPoint[]; lots: BasisLot[]; disposals: BasisDisposal[] }`. `BasisLot`/`BasisDisposal` live in `types.ts` and carry source IDs, raw units, USD fields nullable, version and `classification: "supported" | "review_required"`.

- [ ] **Step 1: Write failing price tests** for a canonical ETH/USDC/WETH map to independently observed Kraken USD candles, unknown token, missing UTC day, stale/incomplete provider result, duplicate observations and a false USDC $1 assumption. Assert unsupported assets and days receive no synthetic observation. Keep the public `/api/market-data` OHLC endpoint separate from portfolio pricing and identify that the current `getMarketHistory()` only maps ETH/BTC.
- [ ] **Step 2: Write failing calculation tests** with a 3-day fixture: day 1 deposit, day 2 market rise, day 3 withdrawal; assert external cash flow is removed from TWR, complete net value uses that day's actual closing quantities, a missing price makes day 2 `netValueUsd: null` and `twrIndex: null`, and the chart cannot connect day 1 to day 3. Include zero opening value, negative debt, fee, internal transfer, a swap with missing output price, unknown classification, FIFO disposal, and basis inherited across an internal transfer. Assert unknown reward/debt/wrap tax treatment stays `review_required` with nullable gain; no tax-advice label.
- [ ] **Step 3: Run** `pnpm --filter @aurel/web test:unit -- portfolio-prices portfolio-calculate`; expect failures.
- [ ] **Step 4: Implement price adapter** with an explicit reviewed canonical-asset-to-provider-instrument map, UTC daily close timestamp/methodology and source version. Validate currency pair, positive finite decimal, date and provider freshness. Fetch and store prices independently of quantity ingestion. WETH may share an ETH observation only with an explicit, versioned 1:1 wrapper methodology and complete wrapper evidence; otherwise give it a gap. Never assume a stablecoin peg. New catalog assets with no covered instrument remain unpriced.
- [ ] **Step 5: Implement calculations.** Close balances from finalized events and complete source intervals; value each valued leg with its day's observed independent price and subtract debt. Require complete event and price coverage for *every* included account/asset before emitting net value. Compute daily flow-adjusted subperiod factors and chain TWR only across contiguous complete days; reset/omit at gaps or zero denominator. Use versioned FIFO lots as a default support method only where acquisition and disposal consideration are both known; transfer lots between owned accounts without realization. Persist nullable proceeds/basis/gain and classification/evidence for every disposal. Changes to calculation rules increment `calculationVersion` and rebuild rather than editing old outputs in place.
- [ ] **Step 6: Run** focused tests and `pnpm typecheck`; expect pass. Commit this task.

### Task 6: Authenticated history and tax support reads

**Files:** Create `apps/web/src/app/api/portfolio/history/route.ts`, `apps/web/src/app/api/portfolio/tax-support/route.ts`; modify `apps/web/src/lib/activity/presentation.ts`, `apps/web/src/components/activity-workspace.tsx`; test `apps/web/tests/unit/portfolio-history-route.test.ts`, `apps/web/tests/unit/portfolio-tax-route.test.ts`, `apps/web/tests/unit/activity-presentation.test.ts`.

**Interfaces:** `GET /api/portfolio/history?range=7D|1M|3M|1Y` returns `PortfolioHistory`; `GET /api/portfolio/tax-support?year=YYYY&cursor=...` returns paginated lots/disposals, `nextCursor`, calculation version, source coverage and `reviewRequiredCount`. Subject comes only from bearer token.

**Implementation scope as of 2026-09-22:** The safe initial publisher prices seven completed UTC days. The API and chart expose only `7D`; `1M`, `3M`, and `1Y` remain planned, not available. Extend pricing, bounded replay, and publication together before restoring those choices. Current source checkpoint status and ingestion version must match each published day before a value is shown.

- [ ] **Step 1: Write failing route tests** for unauthorized/foreign subject, invalid range/year/cursor, empty history, complete days, missing-price day, incomplete Aave source, linked external wallet segregation, and non-finalized current events. Assert 200 responses include `Cache-Control: no-store`, per-day reasons, source and calculation versions; empty or incomplete history returns null value/return, never today's balance.
- [ ] **Step 2: Write failing tax tests** for paginated export with stable cursor, review-required unknown event, a supported FIFO disposal, and a year with incomplete source coverage. Assert CSV formula injection protection remains effective and activity's existing first-50-intents export no longer implies full historical or tax coverage.
- [ ] **Step 3: Run** `pnpm --filter @aurel/web test:unit -- portfolio-history-route portfolio-tax-route activity-presentation`; expect failures.
- [ ] **Step 4: Implement** authenticated D1 reads with subject predicates on every query, bounded range and page size, rate limits, no-store responses and explicit error states. Read current Aave supply/debt afresh, with source time, independently from historical caches. If Aave fails, preserve historical points but set `currentAave.status: "unavailable"`; don't silently omit debt from a displayed current net value. The tax endpoint exports only versioned derived support and per-row evidence; an incomplete year is labelled incomplete. Update the activity export copy to say it is the current displayed activity page and link to the coverage-aware tax support export.
- [ ] **Step 5: Run** focused tests, `pnpm typecheck`, `pnpm lint`; expect pass. Commit this task.

### Task 7: Retire modeled chart and show coverage honestly

**Files:** Modify `apps/web/src/components/portfolio-performance.tsx`, `apps/web/src/components/dashboard.tsx`, `apps/web/src/app/product-system.css`, `apps/web/tests/e2e/product.spec.ts`; create `apps/web/tests/unit/portfolio-chart.test.tsx` if the existing Vitest DOM setup supports React rendering; otherwise exercise chart segmentation via a pure helper in `calculate.ts` and Playwright.

**Interfaces:** `PortfolioPerformance` takes no synthetic `stableBalance`/`etherBalance` props. It fetches authenticated `PortfolioHistory` by selected range and renders each contiguous complete run as a separate SVG path. A `null` value never becomes zero or a fallback to today's holdings.

- [ ] **Step 1: Write failing chart tests** for complete–gap–complete points (two paths, no area across gap), zero history, source loading, price missing, source partial, and return unavailable. Test keyboard range selection and screen-reader text naming the missing days/reasons. Add Playwright checks at desktop and mobile widths in light/dark themes with reduced motion.
- [ ] **Step 2: Run** the focused unit test and `pnpm --filter @aurel/web test:e2e -- --grep 'portfolio history'`; expect failures.
- [ ] **Step 3: Replace** the `/api/market-data?view=history&id=ethereum` fetch and `stableBalance + etherBalance * price` formula. Use `getAccessToken()` and subject-aware query keys, with no-store. Show the latest complete historical value with its date and coverage, or `Unavailable` if the current date is incomplete; show TWR only across a wholly complete selected interval. Draw separate line and fill paths per contiguous run, visible gap markers and a textual coverage list. Distinguish the embedded wallet from linked external wallets and show Aave supply/debt separately; no double count of receipts. Keep all amounts in sensitive display classes.
- [ ] **Step 4: Run** the focused unit test, Playwright desktop/mobile checks, `pnpm typecheck`, `pnpm lint`; expect pass. Commit this task.

### Task 8: Rebuild drill, production smoke, and release gate

**Files:** Modify `scripts/recovery-drill.sh`, `scripts/production-smoke.mjs`; create `docs/operations/portfolio-history.md`; test `apps/web/tests/unit/portfolio-rebuild.test.ts`.

**Interfaces:** `rebuildPortfolioAnalytics(subjectReference, calculationVersion)` is repeatable and scopes deletes to new analytics tables; same source fixture and price observations produce byte-identical daily quantities/values/lots regardless of page order.

- [ ] **Step 1: Write failing rebuild test** that seeds two subjects, durable controls/audit records, mixed finalized/unfinalized events and price observations. Rebuild one subject twice and compare outputs; assert other subject and durable rows unchanged. Include a source outage during rebuild: existing complete published version stays readable until the new version has passed coverage checks.
- [ ] **Step 2: Run** `pnpm --filter @aurel/web test:unit -- portfolio-rebuild`; expect failure.
- [ ] **Step 3: Implement** version-staged rebuild and atomic publish marker, checkpoint/replay operation, indexer failure and coverage alerting in `docs/operations/portfolio-history.md`. Extend `scripts/recovery-drill.sh` to prove analytics can be dropped/recreated while security controls, instructions, and audit evidence survive. Add read-only smoke assertions for authentication, no-store, no synthetic fallback, and a gap when a fixture source is unavailable. Document feature flag, source credentials, backfill rate, rollback to `Unavailable` UI, and exact source capability needed for additional chains. Do not enable complete-history messaging until supported chains/accounts pass source coverage.
- [ ] **Step 4: Run** `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm test:recovery`, focused Playwright product checks, and `pnpm test:production` against a staging URL. Inspect the actual output and document any omitted gate or environmental blocker. Commit this task.

## Final self-review and release notes

- Confirm each program 4 requirement maps to a task: paginated onchain/provider observation (2, 4), provenance/finality/version/completeness (1–4), independent prices (5), actual daily quantities/net value/TWR with gaps (5–7), cost basis and gains (5–6), current Aave supply/debt and external-wallet segregation (1, 2, 6–7), retired modeled chart (7), rebuildability (1, 4, 8).
- Search this plan for `TBD`, `TODO`, unsupported type names and ambiguous status transitions. Confirm tests from **Review Focus** appear in their owning tasks.
- Before rollout, identify each configured chain indexer and price instrument actually covered. Any missing chain, native transfer capability, price, or protocol page remains visibly incomplete. No D1 projection is promoted to ledger authority.
