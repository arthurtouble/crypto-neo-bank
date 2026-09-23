# Portfolio history operations

Historical portfolio data is a rebuildable projection. Wallets, chains, protocol contracts, and contracted providers remain the sources of asset and settlement truth. `portfolio_*` D1 tables are not a customer ledger. Do not use a cached point to decide whether a payment can be sent.

## Current activation boundary

- Account scope comes from a fresh server-side Privy linked-wallet read. A browser address or a `wallet_references` row cannot add an account to history.
- The current historical indexer adapter is Base-only and requires a configured Blockscout Pro credential, working native, internal, and token-transfer pages, and chain-RPC finality checks. Aave activity is a separate source. If either source is unconfigured, incomplete, or does not match its documented response shape, history remains unavailable.
- Source token precision must be an explicit integer from 0 to 36; null, coercible strings, and omitted decimals cannot become zero-decimal balances. A Base event must have an indexed block hash matching the independently checked RPC block. The indexer's transfer participants and amounts are not yet independently checked against transaction/receipt effects, so the adapter deliberately does not promote its counterparty field into an internal-transfer or tax-basis claim. This gap must be closed before linked-wallet transfers can inherit basis automatically.
- When independently proven counterparty legs are introduced, matching also requires the same log position. Equal-sized transfers in one transaction must not be confused with each other; missing or ambiguous positions leave classification unresolved.
- Independent daily USD observations currently cover only the explicitly mapped ETH and USDC instruments. Other assets remain unpriced. The price adapter does not assume a USDC peg or carry a prior price forward.
- A wallet, chain, token, or protocol not covered by every required source is a gap. Do not publish a complete-history claim just because a recent page, current balance, or market quote exists.
- The existing modeled performance series must not be shown as historical account performance. The replacement chart reads only complete, dated projections and leaves gaps unconnected.
- Tax lots and disposals are versioned support records. A transfer between owned accounts preserves basis; a disposal with missing consideration, missing acquisition evidence, or incomplete coverage is `review_required` with a null gain. This is not tax advice.

## Refresh and coverage

`POST /api/portfolio/refresh` ingests one bounded source page for one Privy-linked account and one named source. The client receives an opaque continuation token; the server accepts it only if it matches the stored checkpoint. A full covered-through watermark advances only on an explicit terminal page. A rate limit prevents uncontrolled backfill.

An operations refresh should enumerate the current linked-account set, then advance both required source streams for each account. A failed provider call leaves the previous checkpoint intact. Never infer that an empty page means complete unless the source supplies a terminal continuation state. Monitor failed or repeated cursors, missing native/internal transfer streams, changed block hashes, stale price observations, and unresolved classification.

Derived daily values may be published only after source pages and price observations cover the exact interval. The read API must recheck the current linked-account set and source checkpoints; it must return a null point and reason when a daily result is absent or its evidence no longer passes these checks. A newly linked account needs its own backfill before it can be included in a complete aggregate. An unlinked account must disappear from the next read.

`POST /api/portfolio/materialize` rechecks Privy account scope and publishes only the latest seven completed UTC days. Its bounded replay starts on 2023-01-01, accepts at most four Base accounts and 1,000 raw events, and refuses incomplete checkpoints or a truncated scan. The publication marker and derived rows commit in one D1 batch; history and tax reads select the marker's version rather than an uncommitted higher version. A request with unchanged inputs is idempotent. The current price adapter covers the recent seven-day window, so older ranges and inception return remain unavailable rather than being extrapolated. This endpoint is rate-limited and does not ingest missing source pages automatically.

## Reorganization response

If the indexer block hash differs from canonical RPC evidence, mark affected raw events `reorged`, rewind the source checkpoint, and delete derived quantities, daily results, lots, and disposals from the affected day forward. Keep prior price observations, durable transaction instructions, customer security settings, consent, and audit records. Replay source pages and recalculate after finality. Do not keep displaying a previously complete point as complete during replay.

## Rebuild and rollback

1. Pause publication of new historical results and preserve the current database backup and incident evidence.
2. Confirm fresh Privy scope and source configuration. Check whether the incident is a missing page, an indexer/schema change, a reorganization, a pricing gap, or a calculation defect.
3. Create a new calculation version when logic changes. Re-ingest immutable source evidence, normalize events, fetch independent prices, and derive quantities and values. Do not overwrite a published complete version with a partial rebuild.
4. Compare account/asset quantities against current chain and Aave observations where comparable. Investigate differences and receipt-token double counts before publication.
5. Publish the new version only when coverage checks pass. Otherwise show `Unavailable` with a reason. Re-enable refresh gradually and monitor error and gap rates.

The isolated recovery drill drops and recreates only analytics tables in a restored local database, then checks that security, beta, consent, and operational evidence remain. It does not prove a live provider backfill or authorize production execution.

## Release requirements

Before enabling complete-history messaging, verify the exact provider response fields and commercial rate limits against the contracted account, backfill a controlled test wallet, exercise multi-page continuation and a simulated reorg, and inspect desktop/mobile gap rendering. No real-money transaction is part of QA. Keep production route activation separate from this read-only analytics work.
