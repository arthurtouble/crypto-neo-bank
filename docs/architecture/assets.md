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
| `price` | How the dollar value is read, for totals and daily limits: `usd` (dollar stablecoins at $1), a Kraken market (`eth`, `btc`), or a `chainlink` feed on Base (stocks, gold, the euro) with its decimals, name, and maximum age (four days, so weekend and holiday closes still count). A feed older than that, or with no positive answer, makes the value unavailable (`lib/assets/prices.ts`) |
| `uses` | What it may be used for (below) |
| `note` | Optional line shown to customers, for example what a wrapped asset represents |

| Use | Where it applies | Checked on the server by |
| --- | --- | --- |
| `hold` | Read and shown in the Overview. On Base, except an asset only issued elsewhere, which the account holds there at the same address (Tether Gold on Ethereum) | `lib/overview/read.ts` |
| `deposit` | Added from a connected wallet on its network; bridged to the same asset on Base, which must have `hold` | `POST /api/deposits/quote` |
| `send` | Sent from the Aura account, which holds funds on Base. It can arrive on another network where the same asset has `swap` (`sendDestinations`) | `buildTransfer` in `lib/actions/transfer.ts`; `GET /api/routes/quote` for other networks |
| `swap` | Swapped, or received on another network through Swap or Send | `GET /api/routes/quote`, `GET /api/swap/assets` |
| `invest` | Listed in Invest | `lib/invest/catalog.ts`, then the route quote |

## Adding an asset

Adding is a reviewed code change, so a mistaken or compromised admin account can never list a token.

1. Add an entry to `ASSETS` with the contract from the issuer's own documentation, and the uses it should have.
2. If it needs a price source Aura doesn't have yet, add it first.
3. Run `pnpm assets:check`. It confirms each contract exists, and that its decimals and symbol match the entry. For a `chainlink` price, it also checks the feed's name and decimals, and that it has a positive answer.
4. Run `pnpm test:unit`, open a pull request, and merge. Dev deploys on merge.

## Pausing an asset

An operator can pause any registered asset from the operations console (Assets), with a reason. It takes effect immediately. It stops deposits from other networks, sends, swaps, purchases, earn deposits, and bank payouts in that asset (`requireAsset` and `requireNotPaused` in `lib/assets/pauses.ts`, and `prepareBuiltAction`). Holdings stay visible, because they are facts on the chain. A deposit on Base itself is a plain transfer from the customer's own wallet that Aura doesn't take part in, so no pause can stop it. Resuming deletes the pause. Both are written to `audit_events`, and pauses are stored in the `asset_pauses` table.

Use it when a stablecoin loses its peg, an issuer halts transfers, or a bridge or contract has a problem.

## Tokenized stocks and metals

Registered today: the ten Coinbase tokenized stocks on Base (`AAPLc` … `TSLAc`) and Tether Gold (`XAUt`) on Ethereum.

- **Coinbase stocks are B20 tokens.** They're precompiles, not deployed contracts: `eth_getCode` returns a one-byte `0xef` marker, which `assets:check` accepts. They use 8 decimals and standard ERC-20 transfers and events.
- **Multiplier.** Dividends and splits change a multiplier instead of balances, so a token isn't permanently one share. Each Coinbase Chainlink feed reports the token's total-return value (share price × multiplier), so token amount × feed price is the dollar value. Aura doesn't show a share count.
- **Transfers.** The issuer's policy can block addresses. A blocked transfer reverts and shows as failed.
- **Eligibility.** Coinbase says these tokens are only for persons in eligible places outside the US. The product owner decided Aura lists them without its own eligibility check.
- **Tether Gold** is only issued on Ethereum. The account holds it there, and buying it is a LI.FI route from Base. Its value uses Chainlink's XAU/USD feed on Base. Sends and sales are Ethereum actions, with gas sponsored by Privy on Ethereum. Aura pays that gas.
- **Not on Base:** PAX Gold and S&P 500 or Nasdaq trackers. There's no reliable token for them yet, so they aren't registered. The only "XAUt"-like tokens on Base are a thin third-party wrapper (`oXAUT`) and an unrelated token at XAUt0's Arbitrum address. Neither is Tether Gold.
