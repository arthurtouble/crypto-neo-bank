# Swap execution readiness

This page describes what the current implementation can prove. It is not a launch approval.

## What works in code

- LI.FI quotes are fetched without a required API key. Base USDC/WETH can also be quoted directly from the reviewed Uniswap V3 0.01% pool. A quote is retained as a short-lived, server-held plan; quote metadata alone never authorizes a wallet call.
- Review binds one plan to one authenticated customer, linked wallet, invite, country, independent USD valuation, source balance, and transaction policy.
- Preparation can release only an exact, decoded Base ERC-20 swap with sufficient existing allowance. The direct Uniswap route uses SwapRouter02 `multicall(deadline, [exactInputSingle])` for USDC/WETH at fee tier 100, with recipient and minimum output bound to the review. It rechecks the current route policy, catalog, account controls, rolling limit, source balance, gas reserve, and an on-chain simulation. Unknown calls fail closed.
- If allowance is insufficient, a separate exact-amount ERC-20 approval (or zero reset) can be prepared and tracked. Approval confirmation requires its own canonical, finalized on-chain event. It never confirms the swap or renews an expired quote; the customer must find a fresh route afterward. Approval may persist on chain even if Aurel's record expires.
- The customer must still confirm any released call in their own wallet. The server does not hold a signing key.
- A reported transaction is matched to the prepared call. Confirmation requires a canonical, finalized receipt with the exact source debit and at least the reviewed destination minimum. A LI.FI status of `DONE` is not settlement proof.
- Cross-chain destination evidence has a narrow Across Base-USDC/Arbitrum-USDC event verifier. It matches the finalized source deposit to the finalized destination fill and token credit, rather than trusting a deposit ID or provider `DONE` status alone. It is not connected to an approved source-call preparation flow, so cross-chain execution remains unavailable.

## Live-route finding, 23 September 2026

A read-only LI.FI Base USDC-to-WETH quote returned `nordstern` as its cheapest tool. Restricting the public quote to `uniswap` returned no route; LI.FI's public Base tool list did not include a `uniswap` key. Restricting to `sushiswap` returned a route, but its nested router call is not the audited Uniswap shape. Those LI.FI routes remain denied. A separate direct Uniswap V3 path is now implemented for Base USDC/WETH only, using the official Base factory, QuoterV2, and SwapRouter02 addresses and an independently checked pool. It has not yet been exercised end to end with a customer wallet and real funds.

LI.FI's unauthenticated public API can be used for initial testing. An API key may raise limits, but it does not remove the need to review each executable route and on-chain effect. LI.FI is the quote and route provider, not Aurel's authorization or settlement authority.

## Required before a small-funds release

1. Apply migration `0032_swap_approval_requests.sql` in development after a backup; deploy the Worker and verify the existing `swaps` control remains disabled until a deliberate test window.
2. Rehearse a small self-owned Base USDC/WETH trade, including zero allowance, exact approval, an existing nonzero insufficient allowance, fresh re-quote, user rejection, expired quote, failed receipt, reorg, account lock, and lost-response recovery. The direct route currently has no Aurel integrator fee; do not represent one in pricing.
3. Have an independent reviewer assess the deployed Uniswap contract mapping, canonical calldata decoder, approval flow, simulation, route economics, and receipt verifier. Confirm legal eligibility of launch jurisdictions and assets.
4. Only after those checks, make a separate operator decision to enable the existing `swaps` control for a limited beta. LI.FI nested routes, other assets, tokenized securities, and cross-chain execution require their own explicit audits and release decisions. The Across evidence verifier still needs to be bound to an audited quote, exact source call, approval, status observer, and recovery flow before cross-chain signing can be enabled.

Aurel will use LI.FI as the route provider, including when LI.FI selects Across as the underlying bridge. No direct Across Swap API integration is planned. Across's current Swap API requires its own bearer key and integrator ID, but those are not needed for this LI.FI-only approach. The remaining gate is to decode and audit the exact LI.FI source call, bind it to the Across destination evidence above, and rehearse the complete transfer and recovery flow. See [LI.FI's contract architecture](https://github.com/lifinance/contracts) and [Across event changes](https://docs.across.to/guides/migration/non-evm/indexers).

The current `workers.dev` deployment is a development environment. It is not the production origin or passkey RP ID. Do not describe the swap as live to customers until the release checks above are complete.
