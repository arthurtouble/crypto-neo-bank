# Swap execution readiness

This page describes what the current implementation can prove. It is not a launch approval.

## What works in code

- LI.FI quotes are fetched without a required API key. A quote is retained as a short-lived, server-held plan; quote metadata alone never authorizes a wallet call.
- Review binds one plan to one authenticated customer, linked wallet, invite, country, independent USD valuation, source balance, and transaction policy.
- Preparation can release only an exact, decoded Base ERC-20 swap with sufficient existing allowance. It rechecks the current route policy, catalog, account controls, rolling limit, source balance, gas reserve, and an on-chain simulation. Unknown nested calls fail closed.
- The customer must still confirm any released call in their own wallet. The server does not hold a signing key.
- A reported transaction is matched to the prepared call. Confirmation requires a canonical, finalized receipt with the exact source debit and at least the reviewed destination minimum. A LI.FI status of `DONE` is not settlement proof.
- Cross-chain destination evidence requires a separately reviewed bridge-specific message-link adapter. No such production adapter is configured, so cross-chain execution must remain unavailable.

## Live-route finding, 23 September 2026

A read-only LI.FI Base USDC-to-WETH quote returned `nordstern` as its cheapest tool. Restricting the public quote to `uniswap` returned no route; LI.FI's public Base tool list did not include a `uniswap` key. Restricting to `sushiswap` did return a route, but its nested router call is not the audited Uniswap V3 `exactInputSingle` shape. The current decoder therefore rejects these live quotes. Do not turn on `swaps` merely because the quote API responds.

LI.FI's unauthenticated public API can be used for initial testing. An API key may raise limits, but it does not remove the need to review each executable route and on-chain effect. LI.FI is the quote and route provider, not Aurel's authorization or settlement authority.

## Required before a small-funds release

1. Choose a route that LI.FI actually returns on Base. Review its deployed contracts, bytecode/version, calldata format, and spender behavior. Add a strict decoder and adversarial tests for that exact route. Keep all other routes denied.
2. Add a separately reviewed exact-amount approval step for customers without sufficient allowance. Avoid unlimited approvals; handle tokens that require resetting a nonzero allowance to zero.
3. Complete the wallet confirmation and hash-report flow in the app, with clear rejection, expiry, replacement, and pending states. Never label a quote or prepared call as a completed trade.
4. Configure the exact LI.FI tool, Diamond, approval spender, router, fee forwarder, fee recipients, and target allowlists in the development Worker. Verify them independently against deployed contracts. Configuration is currently absent and defaults to deny.
5. Apply the D1 migration, rehearse rollback, verify controls remain disabled, and run the end-to-end flow with a small self-owned wallet on Base mainnet. Include allowance, successful swap, cancellation, failed receipt, reorg, stale quote, account lock, and lost-response recovery cases.
6. Obtain independent contract/integration security review and legal approval for the launch jurisdictions and assets. Only then make a separate operator decision to enable the existing `swaps` gate. Cross-chain needs its own bridge adapter and release decision.

The current `workers.dev` deployment is a development environment. It is not the production origin or passkey RP ID. Do not describe the swap as live to customers until the release checks above are complete.
