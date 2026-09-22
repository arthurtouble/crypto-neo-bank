# Transaction Evidence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Aurel only marks an onchain financial intent complete when a transaction matching the reviewed action and its expected settlement evidence is independently observed.

**Architecture:** A shared transaction evidence module normalizes and hashes an unsigned call, stores immutable prepared steps under a reviewed intent, and verifies a reported hash against chain transaction and receipt data. Each flow prepares its exact action before asking Privy to sign. Reconciliation reads the chain independently, records uncertainty, and confirms only matching steps and effects. The existing D1 intent remains a workflow and audit projection.

**Tech Stack:** Cloudflare Workers, D1 migrations, TypeScript, Viem, Privy, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-09-22-aurel-product-parity-design.md`

## Global Constraints

- The customer wallet or approved provider is the only transaction submitter. Aurel's server never signs.
- Chain contracts and providers are authoritative for settlement; D1 contains evidence and rebuildable projections, never balances.
- Preserve beta invitations, account lock, address cooling, rate limits, feature flags, recovery, and step up policy.
- Every new financial call is authenticated and bound to a verified wallet, chain, target, value, calldata, action, and expiry.
- A successful receipt alone does not prove the reviewed action occurred. Verify transaction identity and expected effects.
- Missing, stale, replaced, partial, or reorged evidence stays pending or becomes an exception. It cannot become complete.
- Existing historic intents retain their old provenance; migrations do not relabel them as verified.
- Do not edit or stage `apps/kb/src/pages/product-overview.astro`.

## Review Focus

1. A valid hash from another wallet or contract must not confirm an intent: Task 3 tests sender, target, value, calldata, and chain mismatches.
2. A receipt that reverts, lacks required logs, or changes block hash after a reorg must not confirm: Task 4 tests these cases.
3. A quote that expires during token approval must force fresh review before Swap submission: Task 6 tests the post approval expiry branch.
4. A wallet that is not linked to the authenticated Privy subject must not prepare a financial call: Task 3 tests subject ownership.
5. A multi step Aave plan must bind each prerequisite and final action separately: Task 5 tests ordering and exact call counts.

---

### Task 1: Repair Intent Polling

**Files:**
- Modify: `apps/web/src/app/api/intents/status/route.ts`
- Create: `apps/web/tests/unit/intent-status-query.test.ts`

**Interfaces:** `GET /api/intents/status?intentId=UUID` returns the existing `type` response property by selecting `intent_type AS type` from the current schema.

- [ ] **Step 1: Write a failing test.** Exercise the GET handler with an authenticated fixture and a migrated in-memory D1 database containing one intent. Assert 200, its actual type, and subject isolation. The production query must fail on the real `intent_type` schema before the fix.
- [ ] **Step 2: Run the focused test and record the expected SQL column failure.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/intent-status-query.test.ts`.
- [ ] **Step 3: Fix the query.** Select `intent_type AS type`, keep the public response shape, and add `Cache-Control: no-store` to error responses.
- [ ] **Step 4: Run the focused and full unit suites.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/intent-status-query.test.ts` and `pnpm test:unit`.
- [ ] **Step 5: Commit only the focused files.** Use message `fix: read intent status from migrated schema`.

### Task 2: Define Prepared Call and Evidence Records

**Files:**
- Create: `infra/d1/migrations/0014_prepared_intent_calls.sql`
- Create: `apps/web/src/lib/transactions/evidence.ts`
- Create: `apps/web/tests/unit/transaction-evidence.test.ts`

**Interfaces:** `normalizePreparedCall(input)` returns `{chainId, from, to, value, data, dataHash, fingerprint}`; `matchesPreparedCall(prepared, observed)` returns a typed match or mismatch reason. Native value is a base ten integer string; addresses are checksummed for display and lowercase for comparison; calldata is valid hex and SHA-256 hashed. The D1 table `intent_prepared_calls` has `(intent_id, step_index)` primary key, subject, wallet, chain, target, value, calldata hash, semantic action, source reference, expiry, expected effect JSON, reported hash, observed block hash, and verification state.

- [ ] **Step 1: Write failing tests.** Assert equal fingerprints for address case changes and mismatches for altered sender, target, chain, value, or calldata. Assert malformed hex/value is rejected.
- [ ] **Step 2: Run the focused test and observe missing functions.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/transaction-evidence.test.ts`.
- [ ] **Step 3: Implement pure normalization and matching.** Use Viem address and hex validation, decimal integer parsing, `crypto.subtle.digest`, and a stable field order. Add the migration with foreign key to `transaction_intents`, unique reported hash per chain, and indexes for pending verification.
- [ ] **Step 4: Verify tests and migration.** Run the focused test, `pnpm test:unit`, and apply all migrations to a new isolated local D1 store using the project's recovery drill procedure.
- [ ] **Step 5: Commit only Task 2 files.** Use message `feat: define immutable transaction evidence`.

### Task 3: Prepare and Bind Exact Transactions

**Files:**
- Create: `apps/web/src/app/api/intents/prepare/route.ts`
- Modify: `apps/web/src/app/api/intents/status/route.ts`
- Create: `apps/web/src/lib/transactions/chain-observation.ts`
- Create: `apps/web/tests/unit/intent-binding.test.ts`

**Interfaces:** `POST /api/intents/prepare` accepts `{intentId, stepIndex, call, semanticAction, sourceReference, expectedEffect}` after authentication and only while reviewed; it checks ownership against the authenticated subject's verified Privy wallets, validates current policy and feature flag, and writes one immutable prepared step. `POST /api/intents/status` accepts a reported hash only for a prepared step, then compares `eth_getTransactionByHash` against that step before advancing its verification state. If the chain has not indexed the hash, return a pending observation state and retry through reconciliation; do not claim confirmation.

- [ ] **Step 1: Write failing route tests.** Cover another subject's intent, unlinked wallet, changed call after preparation, duplicate step, expired intent, unrelated hash, and valid exact match. Use dependency injected chain observations at the network boundary.
- [ ] **Step 2: Run the focused tests to confirm the unsafe old behavior.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/intent-binding.test.ts`.
- [ ] **Step 3: Implement prepare and hash binding.** Require the existing Privy session and beta access, then use conditional SQL updates to prevent races. A pending chain lookup records the hash as unverified and leaves the intent nonterminal; a mismatch opens an operational issue and rejects the claim.
- [ ] **Step 4: Verify focused tests, all unit tests, typecheck, and lint.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/intent-binding.test.ts`, `pnpm test:unit`, `pnpm typecheck`, and `pnpm lint`.
- [ ] **Step 5: Commit only Task 3 files.** Use message `feat: bind submitted hashes to reviewed calls`.

### Task 4: Reconcile Identity, Receipt, Effects, and Reorgs

**Files:**
- Modify: `apps/web/src/app/api/intents/reconcile/route.ts`
- Modify: `apps/web/src/lib/transactions/chain-observation.ts`
- Create: `apps/web/src/lib/transactions/effects.ts`
- Create: `apps/web/tests/unit/intent-reconciliation.test.ts`

**Interfaces:** `observeTransaction(chainId, hash)` returns transaction, receipt, block hash, confirmation count, and relevant logs from at least one trusted RPC source. `verifyExpectedEffect(prepared, observation)` returns `confirmed | pending | failed | inconsistent`; its first effect types are native transfer, ERC-20 Transfer, ERC-20 Approval, and exact route or protocol action with governed event expectations. Cross network source and destination are separate states.

- [ ] **Step 1: Write failing tests.** Cover transaction missing, wrong sender/target/value/data, reverted receipt, no expected transfer or approval log, changed block hash, and valid confirmed effects. Preserve `submitted` for missing or inconsistent evidence.
- [ ] **Step 2: Run the focused test and record failures.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/intent-reconciliation.test.ts`.
- [ ] **Step 3: Implement reconciliation.** Read the reported hash and immutable prepared call; match transaction identity before receipt; use receipt logs and finality threshold; update intent only when every required step and effect is verified. Open a bounded operational exception for mismatch. Keep legacy intents explicitly `unverified_legacy` in API projection.
- [ ] **Step 4: Verify focused and full suites and a local migration restore.** Run focused Vitest, `pnpm test:unit`, `pnpm test:recovery`, `pnpm typecheck`, and `pnpm lint`.
- [ ] **Step 5: Commit only Task 4 files.** Use message `feat: reconcile exact onchain transaction effects`.

### Task 5: Connect Existing Financial Flows to Prepared Steps

**Files:**
- Modify: `apps/web/src/components/wallet-workspace.tsx`
- Modify: `apps/web/src/components/cross-chain-workspace.tsx`
- Modify: `apps/web/src/components/earn-workspace.tsx`
- Modify: `apps/web/src/components/borrow-workspace.tsx`
- Modify: `apps/web/src/components/defi-positions.tsx`
- Create: `apps/web/src/lib/transactions/prepare-client.ts`
- Create: `apps/web/tests/unit/financial-flow-preparation.test.ts`

**Interfaces:** `prepareIntentSteps(token, intentId, calls)` sends ordered exact calls to the prepare API, returns their step IDs, and rejects when any step is denied. Each UI sends the exact action call before opening the wallet dialog and reports the corresponding step index and hash after signing. Approvals and final calls have separate steps and effects.

- [ ] **Step 1: Write failing tests.** Assert no wallet send occurs when preparation fails; multiple calls preserve order; an approval hash cannot stand in for the final action; unchanged single sends still prepare one step.
- [ ] **Step 2: Run the focused test and observe missing preparation.** Run `pnpm --filter @aurel/web exec vitest run tests/unit/financial-flow-preparation.test.ts`.
- [ ] **Step 3: Integrate each flow.** Preserve current customer confirmation and simulation. Handle cancellation and partial prerequisite completion without relabeling an intent complete.
- [ ] **Step 4: Run focused tests, full unit, typecheck, lint, and desktop/mobile E2E.** Use `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, `pnpm test:e2e`.
- [ ] **Step 5: Commit only Task 5 files.** Use message `feat: prepare each financial action before signing`.

### Task 6: Harden Swap and Aave Plan Validation

**Files:**
- Modify: `apps/web/src/lib/swap/lifi.ts`
- Modify: `apps/web/src/components/swap-workspace.tsx`
- Modify: `apps/web/src/lib/defi/aave.ts`
- Create: `apps/web/src/lib/defi/aave-plan-policy.ts`
- Modify: `apps/web/src/lib/features/flags.ts`
- Create: `apps/web/tests/unit/swap-quote-integrity.test.ts`
- Create: `apps/web/tests/unit/aave-plan-policy.test.ts`

**Interfaces:** Swap response validation checks exact requested raw amount, source and destination token identities, wallet recipient, valid approval target, allowed router, price impact, and chain. Aave validation decodes each call and permits only approved market/token/controller addresses, selectors, exact or bounded approvals, and action amounts. A dedicated `swaps` feature flag gates quote and execution preparation.

- [ ] **Step 1: Write failing tests.** Test a mismatched LI.FI amount, recipient, spender, router, expired quote after approval, arbitrary Aave target, unlimited approval, extra nested call, wrong market, and altered action amount.
- [ ] **Step 2: Run focused tests and record failures.** Run both named test files with Vitest.
- [ ] **Step 3: Implement minimal validation.** Move Swap policy ahead of approval, simulate approval, perform real step up, and refresh expired quotes before final submission. Keep current allowed pairs operational until the universal catalog plan replaces them.
- [ ] **Step 4: Verify focused and full suites plus live read only quote behavior.** Run `pnpm test:unit`, `pnpm typecheck`, `pnpm lint`, and `pnpm test:e2e`; never sign a QA transaction.
- [ ] **Step 5: Commit only Task 6 files.** Use message `fix: validate swap and Aave execution plans`.

### Task 7: Documentation and Release Gate

**Files:**
- Modify: `apps/docs/src/content/docs/product/transaction-lifecycle.md`
- Modify: `apps/docs/src/content/docs/safety/security-model.md`
- Modify: `apps/docs/src/content/docs/concepts/sources-of-truth.md`
- Modify: `PRODUCT_PARITY_ROADMAP.md`
- Modify: `scripts/production-smoke.mjs`

**Interfaces:** Customer documentation states that confirmation follows matched transaction and settlement evidence. Operations documentation states how to resolve mismatches, stale RPC data, and reorgs without manually altering balances.

- [ ] **Step 1: Add a smoke assertion for an unauthenticated prepare request and unsigned or unbound status claim.** It must fail closed.
- [ ] **Step 2: Update docs and roadmap with measured behavior and known limitations.** Remove claims stronger than the implemented checks.
- [ ] **Step 3: Verify app and docs builds, full unit and E2E suites, recovery drill, and production smoke after deployment.** Inspect mobile and desktop in the embedded browser. Do not perform a financial QA transaction.
- [ ] **Step 4: Commit only the documentation and smoke files.** Use message `docs: explain verified transaction evidence`.

### Task 8: Make Value-Based Controls Server-Authoritative

**Finding:** `POST /api/intents/evaluate` currently accepts `estimatedUsd` and `availableUsd` from the browser. A customer can understate value to bypass the daily limit, new-address threshold, large-transfer delay, and step-up requirement. This must be corrected before any financial execution is enabled on this branch.

**Files:** Create `apps/web/src/lib/transactions/valuation.ts` and focused tests; modify `apps/web/src/app/api/intents/evaluate/route.ts`, `apps/web/src/lib/transactions/policy.ts`, and affected callers/tests.

- [ ] **Step 1: Write failing tests.** A client reports `estimatedUsd: 0` for a large USDC/ETH/WETH transfer, Swap, or Aave action; the server must compute or obtain a current independently sourced upper-bound valuation. Price/source outage and unsupported asset must block value-sensitive execution, never turn controls into warnings. Test stale prices, decimal precision, and cross-chain token identity.
- [ ] **Step 2: Implement trusted valuation.** Resolve the reviewed asset by canonical chain/contract, parse amount with trusted decimals, and obtain a bounded-freshness price from an independent market source or validated provider quote. For a stablecoin, use a conservative value for risk limits and label depeg uncertainty. Do not use browser `estimatedUsd` or `availableUsd` as policy authority; remaining balance controls require independently read wallet/provider balances or stay unavailable.
- [ ] **Step 3: Bind policy evidence.** Persist raw units, price source, observed-at, computed USD value, freshness, and policy version with the reviewed intent. Revalidate at preparation when the policy validity window has elapsed or a prerequisite approval has changed exposure. Derive rolling spend from verified, bound intents rather than client-provided JSON fields.
- [ ] **Step 4: Verify.** Run focused tests, all unit tests, typecheck, lint, desktop/mobile E2E, and a read-only production valuation smoke. Do not sign a QA transaction. Commit only these files.

## Dependency order

Tasks 1 and 2 can be developed independently. Task 3 depends on Task 2. Task 4 depends on Task 3. Task 5 depends on Tasks 3 and 4. Task 6 may develop its pure validators alongside Tasks 3 and 4 but UI integration depends on Task 5. Task 8 can develop its pure valuation module alongside Tasks 3–6 but must gate production execution. Task 7 follows all code changes, including Task 8. The separate asset, portfolio, and wealth plans depend on this foundation where they submit transactions.
