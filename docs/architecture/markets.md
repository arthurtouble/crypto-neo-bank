# Markets: perps and predictions

Aura gives customers perpetual futures on Hyperliquid and prediction markets on Polymarket. Aura is a front end, not a broker: the customer's own Privy wallet owns the account at each venue, and Aura never holds or moves their money. Code is in `apps/web/src/lib/markets/`, API routes are under `/api/perps/*` and `/api/predictions/*`, and two switches gate them: `perps` and `predictions` ([launch controls](../operations/launch-controls.md)). Both are off by default.

Owner decisions (3 October 2026): no jurisdiction blocks for now, no Aura fee, no leverage cap beyond each market's own maximum, and no sports or esports markets.

## Who holds what

| | Hyperliquid (perps) | Polymarket (predictions) |
| --- | --- | --- |
| Venue account | The customer's Privy wallet address on HyperCore | A Polymarket Deposit Wallet on Polygon, owned by the customer's Privy wallet |
| Signs orders | Aura's per-customer trading key: a Privy server wallet that the customer's wallet approves once (`approveAgent`). Hyperliquid never lets it withdraw or transfer. | The customer's wallet, with their passkey, for each order. Session keys need Polymarket's approval of Aura's builder key. |
| Signs withdrawals | The customer's wallet only | The customer's wallet only |
| Aura keeps | The trading key's Privy wallet ID and address | The Deposit Wallet address and its order-book API key, encrypted with `MARKETS_CREDENTIAL_KEY`. The key can read and cancel orders but can't sign one or move funds. |

Everything the customer's wallet signs follows one path (`lib/markets/signing.ts`). The server builds the exact EIP-712 data and keeps it for 5 minutes in `market_signature_requests`. The browser signs Privy's authorization request with the passkey, and the server relays it, so Privy signs only that data, once. A Polymarket signature is also recovered and checked against the owner before it is sent.

D1 never owns money here either. `market_accounts` says which venue account the wallet uses; `market_operations` records what Aura sent and the venue's answer (source, external ID, status, `observedAt`). Balances, positions, orders, and fills are read from the venue on every request, and a failed read is shown as unavailable.

## Perps on Hyperliquid

1. **Add money.** `POST /api/perps/deposit` prepares a route action that burns Base USDC with Circle's CCTP (fast transfer to HyperEVM, domain 19). Its hook tells Circle's forwarder to credit the same wallet's perps balance on HyperCore, in seconds. Circle's protocol and forwarding fees come out of the amount and the review shows them; Aura takes none. The action settles only when Circle's message for this burn names the customer's perps balance and is forwarded, and Hyperliquid's ledger shows the credit for at least the minimum (`verifyCctpDeposit`, see [money actions](money-actions.md)). HyperCore's ledger hash is its own, so the credit is matched by amount, recipient, and time. Hyperliquid needs at least 5 USDC to arrive, so the minimum deposit is 6 USDC.
2. **Set up.** `POST /api/perps/setup` creates the trading key and returns `approveAgent` for the passkey; `POST /api/perps/signatures` sends it. Hyperliquid accepts this only after the first deposit. The trading key then puts the account in standard mode (`agentSetAbstraction`), where each dex keeps its own USDC balance.
3. **Trade.** `POST /api/perps/trade` takes what the customer picks: market, long or short, a dollar margin, leverage, cross or isolated, market or limit, and an optional take profit and stop loss. It sets the market's leverage and margin mode, moves margin into a stock market's dex if that dex is short (`agentSendAsset`, which only moves money within the account), then places the order with the auto-close orders attached. `POST /api/perps/trade/preview` returns the size, notional, margin, and estimated liquidation price without placing anything. `/positions/tpsl` sets auto-close on an open position; `/orders`, `/orders/cancel`, `/positions/close`, and `/leverage` cover the rest. The trading key signs each one; no passkey is needed. Market orders are immediate-or-cancel at the mid price ± 1%, as Hyperliquid's own SDKs place them. Orders under $10 are refused unless reduce-only.
4. **Withdraw.** `POST /api/perps/withdraw` asks the customer's wallet to sign `sendToEvmWithData`, which Circle's CCTP delivers as USDC to the same address on Base.

Markets include Hyperliquid's own and the HIP-3 dexes margined in USDC (stock perps such as `xyz:SPCX`), with sports screened out by dex and market name. An order's asset ID for a HIP-3 market is `100000 + dex index × 10000 + index`. Estimated liquidation prices use Hyperliquid's documented formula with a maintenance rate of 1 / (2 × max leverage); margin tiers for very large positions aren't modelled.

`GET /api/perps/markets` lists markets and prices (public; an isolate reuses the list for 5 seconds, since listing every dex spends Hyperliquid's per-IP budget). `GET /api/perps/account` reads margin per dex, positions, open orders, and fills.

## Predictions on Polymarket

1. **Set up.** `POST /api/predictions/setup` takes one step per call: deploy the Deposit Wallet through Polymarket's relayer (Aura's builder key pays the gas), then the wallet's contract approvals (one passkey), then the order-book sign-in (one passkey). The order-book key is sealed and stored.
2. **Add money.** `POST /api/predictions/deposit` prepares a transfer of Base USDC to the wallet's Polymarket bridge address, which credits it as pUSD. It is the customer's own money moving between their accounts, so it doesn't count toward the daily limit; `predictions` gates it.
3. **Trade.** `POST /api/predictions/orders/buy` prices a dollar amount against the book and returns the order for the passkey, with the estimated shares and the payout if it wins. `/orders/sell` sells shares at the best bid less 2%. `POST /api/predictions/signatures` posts the signed order. `/orders/cancel` cancels a resting one.
4. **Withdraw and collect.** `/withdraw` sends pUSD to a bridge address that pays out USDC on Base to the account. `/redeem` collects a resolved market's winnings. Both are wallet batches signed with the passkey.

`/events`, `/up-or-down`, `/markets/[id]`, and `/history` read Polymarket's public data. `/markets/[id]` takes a Gamma market id or a market slug, since Polymarket's positions name their market by slug. Sports and esports are filtered twice: Gamma excludes the Sports tag, then every event and market is checked again for sports and esports tags, game IDs, and team IDs (`isSports`). A sports market answers as not found.

## Configuration

- `MARKETS_CREDENTIAL_KEY` (secret): 32 random bytes, base64.
- `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_SECRET`, `POLYMARKET_BUILDER_PASSPHRASE` (secrets) and `POLYMARKET_BUILDER_CODE` (variable), from Polymarket's builder settings.
- The Privy app must allow server wallets, for trading keys.

## Not done yet

- Polymarket session keys, so an order needs no passkey. They need Polymarket to approve the builder key.
- Live checks on dev with real funds. The migration and secrets are on dev (3 October 2026); the code reaches dev when this merges. Signing was checked against Hyperliquid's live API with throwaway keys (its errors named exactly the signing address), and the CCTP burn was simulated on Base; fills, margin moves, and a real deposit are not yet checked.
- HIP-3 dexes may charge higher trading fees than the main dex; the order sheet doesn't show them yet.
