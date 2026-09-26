---
title: Money actions
description: How Aura prepares, signs, verifies, and records every customer money movement.
---

Every customer money movement is an **action**: a send, an earn deposit or withdrawal, a swap, a cross-chain deposit or withdrawal, or an invest order. All of them use one pipeline, one table, and one verifier. Provider-specific code only builds calls and describes the expected effects.

## Accounts

Each customer's account is their Privy embedded wallet, with gas paid by Privy. See [accounts and custody](accounts-and-custody.md) for how actions are signed and relayed, where keys live, and how to leave Privy.

- Privy handles sign-in, the key, recovery, and export.
- The embedded wallet holds funds. Its address is the customer's deposit address and the only address Aura prepares actions for. A wallet used to log in, such as MetaMask, never holds Aura funds and is never shown as the account.
- An action's calls are sent as one sponsored batch, so an approval and the action it enables are one signature and one onchain operation.
- Adding money starts from the wallet the customer connected, such as MetaMask (`add-from-wallet.tsx`), with a network and an asset: Base, Ethereum, Arbitrum, Optimism, or Polygon, and ETH or USDC (`lib/deposits/networks.ts`). From Base it is a plain transfer. From another network, `POST /api/deposits/quote` gets a LI.FI route for the same asset on Base, paid to the Aura account from a wallet Privy shows is linked to the customer; bridge fees come out of the amount that arrives. The connected wallet signs and pays the source network fee. `GET /api/deposits/status` reports LI.FI's progress; the balance itself is read from Base. Deposits are not actions: the Aura account signs nothing, so nothing is stored in D1. Card payment goes through Privy's funding flow (`useFundWallet`, opened on the card method). The address and QR code remain for sending from anywhere else, on Base only.

Configuration lives in the Privy dashboard, not in code: TEE execution and gas sponsorship (app pays) on every chain Aura sends from. Aura's verifier decodes EntryPoint v0.6, v0.7, and v0.8 bundles with Kernel v3 or Coinbase Smart Wallet encodings; other account types are reported as unrecognized rather than guessed.

## Pipeline

```mermaid
sequenceDiagram
    participant C as Customer (browser)
    participant A as Aura API
    participant W as Privy (relay)
    participant B as Base
    C->>A: POST /api/actions {kind, ...}
    A->>A: flags, account lock, limits, recipient rules, valuation
    A->>A: build calls + expected effects, store action (prepared)
    A-->>C: actionId, calls, review summary
    C->>A: POST /api/actions/:id/authorize
    A-->>C: Privy wallet_sendCalls request
    C->>C: sign request (authorization key)
    C->>A: POST /api/actions/:id/submit {signature}
    A->>W: relay signed request, gas sponsored
    W->>B: one batched operation
    W-->>A: transaction ID (hash once it lands)
    C->>A: GET /api/actions/:id (poll)
    A->>B: receipt, block, finality
    A->>A: verify operation identity and effects
    A-->>C: confirmed / failed / settling
```

1. **Prepare.** The server checks the feature switch, the account lock, the customer's limits and recipient rules, and values the action in USD. A builder returns the exact calls and the effects they must produce. The action is stored as `prepared` with a fingerprint of its calls and a short expiry.
2. **Sign.** The browser signs Privy's request for exactly those calls with the customer's authorization key, and the server relays it with gas paid. The server never signs and cannot change what was signed.
3. **Submit.** The browser reports the transaction hash. The hash binds to one action only.
4. **Verify.** On each status read, the server reads the receipt independently and decides:
   - **Identity.** The transaction is an EntryPoint `handleOps` call containing an operation from the customer's account whose decoded calls equal the prepared calls, and its `UserOperationEvent` reports success.
   - **Finality.** Base: 3 confirmations and at or below the finalized block. Ethereum: 12. Base finalizes 15 to 25 minutes after inclusion, so an operation that fully matches after 3 confirmations becomes `settling` (shown as sent for a same-chain action) and `confirmed` at finality. Before finality nothing fails: a mismatch or revert waits for the final block to decide.
   - **When.** An action is verified when the customer reads it, when Activity opens (up to 3 open actions), and every 2 minutes by the web Worker's cron (`apps/web/worker/index.ts`, `lib/actions/recheck.ts`). The cron checks up to 20 submitted or settling actions not checked in the last minute, least recently checked first, one at a time, and expires prepared actions whose signing window passed.
   - **Reads.** Each read falls back across the chain's public endpoints. publicnode refuses receipts as archive requests, so the receipt reads move on to the next endpoint.
   - **Effects.** Within that operation's logs, every expected effect is present: the exact ERC-20 transfer, the Aave `Supply` or `Withdraw` event, the Sky vault events, or the route's source debit and minimum output.
   - **Delivery.** Cross-chain routes stay `settling` until LI.FI reports the destination transaction and the destination receipt shows at least the minimum output reaching the customer.

A failed identity or effect check marks the action `failed` with a reason. An action whose hash never arrives expires as `expired`, which the UI shows as "not confirmed by Aura, check your wallet activity", never as failed.

D1 records are projections. A `confirmed` row reflects chain evidence Aura observed; the chain remains the authority.

## Kinds

| Kind | Builder | Calls | Effects |
| --- | --- | --- | --- |
| `transfer` | `lib/actions/transfer.ts` | ERC-20 `transfer`, or a native value call | ERC-20 `Transfer` from the wallet; native transfers rely on operation identity |
| `earn` | `lib/actions/aave.ts`, `sky.ts` | exact approve + Pool `supply`, or Pool `withdraw`; Sky equivalents | Aave `Supply`/`Withdraw` for the wallet; Sky vault events |
| `route` | `lib/actions/route.ts` | LI.FI approval (if needed) + LI.FI call | source debit of the exact amount; same-chain minimum output, or cross-chain delivery |

Swap, invest, cross-chain deposit, and cross-chain withdrawal are all `route` actions. They differ in presentation, not mechanics.

## Routes (LI.FI)

`GET /api/routes/quote` asks LI.FI for a quote with the Aura account as sender and recipient, validates it, and stores it server-side as a `route_quote` with a short expiry. The browser receives an opaque quote ID, never raw calldata to trust.

Validation checks the assets, chains, amounts, recipient, slippage, price impact, and that the call target and approval spender are the LI.FI Diamond (`0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE`). Aura does not decode bridge-specific calldata: outcome verification is the control. LI.FI's integrator fee is set by `LIFI_INTEGRATOR_FEE` (a fraction, default 0) with integrator `aura`.

## Limits and recipient rules

These are customer settings, off by default, stored in `security_profiles`:

- **Account lock** blocks every action.
- **Daily limit** (`daily_limit_cents`, null means none) caps the rolling 24-hour USD value of outgoing actions (transfers and routes; earn moves between the customer's own positions and does not count). If a limit is set and an action cannot be valued, it is blocked.
- **Saved recipients only** (`enforce_address_book`) blocks transfers to unsaved addresses.
- **New recipient cooling** (`new_address_delay_seconds`, default 4 hours) delays a newly saved address before it counts as saved.

Today these are enforced by the server on the actions it prepares. They do not stop a customer who exports their key and signs elsewhere. Onchain or Privy-policy enforcement is a separate, later feature ("Wealth protection"); the settings UI must say which kind of enforcement applies.

Bank limits come from Bridge once connected and appear beside these.

## Valuation

`lib/actions/valuation.ts` values the source amount: known stablecoins at $1 (a depeg below $1 still counts as $1), ETH and WETH from a fresh Kraken one-minute candle. Other route sources use LI.FI's quoted USD value, recorded with source `lifi:quote`. The value and its source are stored on the action.

## Data

- `actions`: one row per action. Calls, effects, and review summary are immutable after insert. Status moves forward only: `prepared` → `submitted` → `settling` → `confirmed`, or `failed` / `expired`.
- `action_events`: append-only evidence (submission, checks, delivery).
- `route_quotes`: server-held LI.FI quotes, deleted after expiry unless used by an action.

## API

| Route | Purpose |
| --- | --- |
| `POST /api/actions` | Prepare an action |
| `POST /api/actions/:id/submit` | Report the transaction hash |
| `GET /api/actions/:id` | Status; verifies on read, rate-limited |
| `GET /api/routes/quote` | Server-held LI.FI quotes |
| `GET /api/swap/assets` | Asset catalog for route pickers |
