# Governed Aave Execution Plan

> Execute against the approved [product-parity design](../specs/2026-09-22-aurel-product-parity-design.md) and [transaction-evidence plan](2026-09-22-transaction-evidence.md). Write failing tests before each implementation step. Do not enable Earn, Borrow, Repay, Withdraw, or reward-claim signing from an opaque provider plan.

## Goal and authority

Let an eligible customer explicitly sign a narrowly reviewed Aave V3 action from their linked wallet, with a fresh health/risk preview and independent settlement evidence. Aave contracts and chain reads own positions and debt; D1 records instructions and evidence, not balances. The MCP `preview_action` and `prepare_action` outputs are inputs to validation, not authority to sign. Existing UI remains read-only until exact-call policy, transaction-bound step-up, simulation, and settlement gates pass.

## Stage 1 — Reviewed action and semantic plan policy

Before any execution flag is enabled, retire or gate the current `/api/defi/aave/action` and `/api/defi/aave/rewards` raw unsigned-plan responses. They currently expose opaque MCP plan/transaction calls to the browser. Add route tests proving no executable calldata or arbitrary claim call escapes in read-only mode or after the governed plan path is introduced.

Define a server-held plan bound to subject, linked wallet, Base chain ID 8453, exact governed Pool/asset addresses, action, raw amount/max mode, recipient/on-behalf-of, referral, collateral choice, current Aave position and health preview, expiry, and policy version. Decode every provider call and reject unknown targets/selectors or extra nested calls. Initial allowlist:

| Action | Pool selector | Required semantic fields |
| --- | --- | --- |
| Supply | `0x617ba037` | governed asset, exact amount, `onBehalfOf=self`, fixed referral |
| Withdraw | `0x69328dec` | governed asset, `to=self`, exact amount or explicitly reviewed max |
| Borrow | `0xa415bcad` | governed asset, exact positive amount, variable rate mode 2, `onBehalfOf=self`, fixed referral |
| Repay | `0x573ade81` | governed asset, exact amount or explicitly reviewed max, variable rate mode 2, `onBehalfOf=self` |

ERC-20 `approve` (`0x095ea7b3`) is allowed only for the exact governed source token and Pool spender, with the smallest sufficient bounded amount. No unlimited approval. Do not accept native gateways, permits, credit delegation, multicall, third-party beneficiary, eMode, or collateral toggles until separately modeled and reviewed. If `enableCollateral` produces another call, it is a distinct explicit step with its own evidence; do not infer it from the flag. Reward claims remain disabled until the actual Base distributor target, selector, beneficiary, reward assets, and event ABI are independently resolved; an arbitrary MCP claim call is not eligible.

Tests first: wrong chain/from/Pool/token/selector, changed raw amount, altered max mode, wrong recipient/onBehalfOf/rate/referral/spender, unlimited approval, extra call, stale plan, and valid exact cases. Version the governed contract policy and test deployed Base bytecode/address-book expectations read-only.

## Stage 2 — Current risk checks and ordered preparation

The disconnected `assessAaveActionRisk` helper now covers exact raw-amount valuation, conservative debt/collateral rounding, protocol borrowing power, a post-action health floor, reserve flags, caps, liquidity, and debt-free withdrawals. Its input is not yet built from independent block-bound Pool/oracle/account reads. It does not compare the MCP preview, simulate a call, authorize a signature, or change the read-only action routes. A caller must prove all source fields are from the same fresh canonical block and recheck immediately before signing; until then this is a tested calculation, not an execution gate.

Before preparation, recheck invitation/country/capability, feature and incident switches, account lock, linked wallet, independent valuation/balance, transaction policy, and fresh Aave reads. Show post-action health for borrow or collateral withdrawal. Independently calculate the proposed post-action health from current Pool account/reserve configuration, oracle prices, and exact proposed amount at a bounded-freshness block; do not use MCP `preview_action` alone as Aurel's safety decision. Reject a material preview/independent mismatch. Apply an Aurel-configured conservative minimum strictly above protocol liquidation HF 1 only when a complete current debt read shows debt remains; a debt-free supplier may have HF 0 without liquidation exposure, and missing debt coverage fails closed. A preview is not a guarantee. Respect reserve paused/frozen state, supply/borrow caps, available liquidity, collateral configuration, and debt. A paused reserve blocks all four actions; a frozen reserve may still allow withdraw/repay. If coverage is missing, say unavailable rather than zero. Simulate every exact call before wallet confirmation and recheck immediately before signing.

When allowance is insufficient, prepare an exact bounded approval as a separate immutable step. Verify its receipt/finality/effect, then call `prepare_action` again, because Aave MCP may change its ordered prerequisites after approval. Compare the refreshed call against the originally reviewed action and current risk limits. A changed amount, mode, asset, beneficiary, health, or material cost requires customer review. Each step needs transaction-bound server-verifiable step-up when policy requires it; a Privy MFA modal alone is insufficient. The server does not sign.

Tests: allowance race, approval revert/reorg, changed `prepare_action` output, cap/liquidity deterioration, independently calculated HF below floor, MCP/independent HF mismatch, debt-free full withdrawal with HF 0, missing debt/price/position coverage, account lock, expired review, unsupported market, simulation failure, wallet cancellation, and resume after an approved prerequisite. For max repay, use independently observed debt plus a bounded interest buffer and available wallet balance; never approve uint256.max by default.

## Stage 3 — Chain effects and read reconciliation

Bind each reported hash to exact prepared from/to/value/data, successful receipt, canonical block, and finality. Verify governed Pool events for the reviewed action: `Supply` reserve/user/onBehalfOf/amount; `Withdraw` reserve/user/to/amount; `Borrow` reserve/user/onBehalfOf/amount/rate mode; `Repay` reserve/user/repayer/amount and no aToken repayment. Match bounded max amounts to current chain evidence; preserve uncertainty on missing or partial effects. Refresh Aave positions only after chain evidence, and keep any provider read outage distinct from a zero position. An approval log proves only allowance, never final Earn/Borrow completion. Replacements and reorgs downgrade state; no automatic resend.

Tests: hash substitution, wrong event reserve/actor/amount, reverted or missing receipt, approval-only completion attempt, max slippage, changed canonical block, replacement, RPC outage, and idempotent restart reconciliation. Then add an independently audited rewards-claim variant with its own controller ABI and beneficiary/effect tests.

## Stage 4 — Experience and activation

Present underlying asset, expected rate source/time, collateral and liquidation risk, liquidity/withdrawal terms, fees, and current Aave position in plain language. Use Review → Confirm → Submitted → Complete/exception states. Preserve a visible read-only state until stages 1–3 pass independent review. Run unit, migration/recovery, typecheck, lint, build, desktop/mobile keyboard and reduced-motion checks, plus read-only Base contract checks. Only designated humans may test small-funds mainnet transactions; automation never signs. Security, protocol-risk, legal, incident-response, and rollback approval precede activation.

Sources: [Aave MCP tools](https://aave.com/docs/mcp/tools), [Aave MCP safety](https://aave.com/docs/mcp/safety), [Aave V3 Pool interface](https://github.com/aave/aave-v3-core/blob/master/contracts/interfaces/IPool.sol), and [Aave Base address book](https://github.com/aave-dao/aave-address-book/blob/main/src/AaveV3Base.sol).
