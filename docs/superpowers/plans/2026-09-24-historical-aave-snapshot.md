# Historical Aave snapshot implementation

**Goal:** Establish a fail-closed, read-only chain-evidence path for a single completed UTC day. Do not publish historical USD balances until archive-source, pricing, and reconciliation gates pass.

**Architecture:** Resolve a canonical finalized day-end Base block, then read historical Aave registry, reserves, balances, and precision at its hash. Keep the result private to server code. The existing live Aave reader and chart remain unchanged.

**Stack:** TypeScript, viem, Vitest, Cloudflare Worker runtime.

## Task 1: UTC block evidence

- Add tests for exact-midnight boundary, invalid/incomplete days, finality, missing blocks, and changed evidence.
- Implement bounded binary search with successor bracketing and canonical re-read.
- Run focused tests and typecheck.

## Task 2: Historical Aave raw positions

- Add tests for historical registry resolution, all reserves, supply and both debt modes, empty positions, malformed batches, archive errors, and reorganization.
- Implement hash-pinned reads and strict complete/unavailable result. Never infer a zero from failed RPC.
- Run focused and existing current-Aave tests.

## Task 3: Integration and release boundary

- Document raw-reader coverage and remaining USD-history gates in operations and roadmap.
- Run full unit, typecheck, lint, build and recovery/readiness checks.
- Commit code and docs; deploy only if runtime behavior changes, with dev smoke and all financial-action flags confirmed off.
