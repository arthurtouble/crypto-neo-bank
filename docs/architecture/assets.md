---
title: Supported assets
description: The asset registry, how to add an asset, and how to pause one.
---

Aura supports a fixed list of assets: the **registry** in `apps/web/src/lib/assets/registry.ts`. Nothing outside it can be shown, deposited, sent, swapped, or bought, on screen or through the API. Privy and LI.FI don't decide what's supported. LI.FI only prices and routes assets the registry already allows.

## What an entry says

Each asset is identified by network and contract, never by ticker:

| Field | Meaning |
| --- | --- |
| `id`, `chainId`, `address` | `<chainId>:<lowercase contract>`, or `<chainId>:native` for the network's coin |
| `symbol`, `name`, `decimals` | Must match the contract; `pnpm assets:check` verifies them on chain |
| `category` | `cash`, `crypto`, `stock`, or `metal`. Cash is its own group in the Overview; the rest show under crypto. Crypto, stocks, and metals are also the categories in Invest |
| `price` | How the dollar value is read, for totals and daily limits: `usd` (stablecoins at $1) or a Kraken market (`eth`, `btc`). A new kind of asset (gold, stocks) needs a new price source added in `lib/actions/valuation.ts` and `lib/overview/read.ts` first |
| `uses` | What it may be used for (below) |
| `note` | Optional line shown to customers, for example what a wrapped asset represents |

| Use | Where it applies | Checked on the server by |
| --- | --- | --- |
| `hold` | Read and shown in the Overview (Base only) | `lib/overview/read.ts` |
| `deposit` | Added from a connected wallet on its network; bridged to the same asset on Base, which must have `hold` | `POST /api/deposits/quote` |
| `send` | Sent from the Aura account (Base only) | `buildTransfer` in `lib/actions/transfer.ts` |
| `swap` | Swapped, or received on another network | `GET /api/routes/quote`, `GET /api/swap/assets` |
| `invest` | Listed in Invest (Base only) | `lib/invest/catalog.ts`, then the route quote |

## Adding an asset

Adding is a reviewed code change, so a mistaken or compromised admin account can never list a token.

1. Add an entry to `ASSETS` with the contract from the issuer's own documentation, and the uses it should have.
2. If it needs a price source Aura doesn't have yet, add it first.
3. Run `pnpm assets:check`. It confirms each contract exists, and that its decimals and symbol match the entry.
4. Run `pnpm test:unit`, open a pull request, and merge. Dev deploys on merge.

## Pausing an asset

An operator can pause any registered asset from the operations console (Assets), with a reason. It takes effect immediately. It stops deposits from other networks, sends, swaps, purchases, earn deposits, and bank payouts in that asset (`requireAsset` and `requireNotPaused` in `lib/assets/pauses.ts`, and `prepareBuiltAction`). Holdings stay visible, because they are facts on the chain. A deposit on Base itself is a plain transfer from the customer's own wallet that Aura doesn't take part in, so no pause can stop it. Resuming deletes the pause. Both are written to `audit_events`, and pauses are stored in the `asset_pauses` table.

Use it when a stablecoin loses its peg, an issuer halts transfers, or a bridge or contract has a problem.

## Tokenized stocks and metals

They're added like any other asset, with category `stock` or `metal`, and appear in Invest once registered. Two technical checks matter before adding one:

- **Transfers:** some issuers only allow transfers between approved wallets. A token like that fails in swaps and sends even though it's registered.
- **Price:** the Overview and daily limits need a dollar price. Stablecoins and ETH/BTC are covered today; gold and stocks need a feed first.
