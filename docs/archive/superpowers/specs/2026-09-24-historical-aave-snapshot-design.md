# Historical Aave Snapshot Evidence

Date: 2026-09-24  
Status: Implementation scope approved by the user's standing instruction to continue autonomously; publication and production source acceptance remain gated

## Purpose and boundary

Aurel's historical chart cannot count current Aave supply or debt as if it had been held on every prior day. The current four-action activity feed also cannot reconstruct accrued interest, token transfers, liquidation effects, or a dated closing balance. Build a **read-only Base Aave V3 snapshot reader** for one completed UTC day. Its first version returns raw reserve quantities and chain evidence to server code only. It does not write D1, change the customer chart, claim yield or returns, or enable Aave signing.

The result is useful only after later work joins it with complete wallet-source coverage, all relevant historical reserve prices, and independently reviewed cash-flow classification. Until then, existing chart gaps remain. See [portfolio operations](../../operations/portfolio-history.md).

## Choice

Three approaches were considered: replay Pool activity, ask an Aave-facing API for historical positions, or read archived contract state. Activity replay is insufficient for interest and unobserved position changes. A provider API may help reconcile but is not independent on-chain evidence. The chosen source is archived Base state at one canonical block per UTC day, with the existing governed Aave addresses provider as the registry of the **historical** Pool and data provider. Do not assume today's data-provider address was already active at an old block. The Aave [addresses provider](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/protocol/configuration/PoolAddressesProvider.sol) exposes those registrations; the [data provider](https://github.com/aave-dao/aave-v3-origin/blob/main/src/contracts/helpers/AaveProtocolDataProvider.sol) reads aToken and debt-token balances. Hash-pinned `eth_call` with `requireCanonical` follows [EIP-1898](https://eips.ethereum.org/EIPS/eip-1898).

## Snapshot algorithm

1. Accept only a server-verified Base account ID and a completed `YYYY-MM-DD` UTC day. Reject future/current days and malformed dates. The endpoint to expose this to a customer is **out of scope**.
2. Find the last finalized block whose timestamp is strictly before the following UTC midnight. Its successor must exist and have a timestamp at or after midnight. Use a bounded binary search of block numbers, and reject missing, inconsistent, or nonmonotonic block evidence. Require a valid, nonzero block hash. Re-read the chosen block and successor after the position scan; a different hash, number, or timestamp invalidates the result.
3. At the chosen hash, resolve Pool and data-provider addresses from the governed addresses provider. Reject zero or malformed addresses and missing deployed code. Enumerate every historical Pool reserve, reject an empty/duplicate/oversized list, and batch every `getUserReserveData` call through Multicall3 pinned to the same hash. Batch precision/configuration reads for every nonzero position. Sum stable and variable debt; preserve underlying units and explicit decimals. Any failed call, malformed tuple, missing configuration, or unknown ABI shape makes the entire snapshot unavailable—not a zero.
4. Return the exact day, block number/hash/time, registered contract addresses, and raw supply/debt legs with `status: complete` only after the whole reserve set and final canonicality check pass. Empty legs mean a proved zero position for that day, **not** complete portfolio history. Bound structured diagnostics to a stage and error class; never log wallet addresses or RPC bodies.

## Performance and release boundary

The read is one day/one account per invocation. It is not a loop over 90 days in a customer request. A later controlled backfill can materialize verified snapshots to D1 with explicit source version and coverage checkpoint; D1 remains a projection. That later phase needs a contracted archive RPC, provider-shaped integration tests, independent reconciliation against Aave token balances/events, pricing for every nonzero asset, reorganization recovery, and an independent security/data-quality review before publishing a USD history. A public RPC proving a few old calls is not a production SLA.

Tests must cover the UTC boundary, finality, account/day validation, historical registry change, every reserve and both debt modes, empty proved positions, malformed batch output, archive failure, missing code, and reorg. The existing current Aave reader and its customer-visible behavior must stay unchanged.
