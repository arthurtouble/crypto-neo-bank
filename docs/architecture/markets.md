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

1. **Add money.** `POST /api/perps/deposit` prepares a route action that burns Base USDC with Circle's CCTP (fast transfer to HyperEVM, domain 19). Its hook tells Circle's forwarder to credit the same wallet's perps balance on HyperCore, in seconds. Circle's protocol and forwarding fees come out of the amount and the review shows them; Aura takes none. The action settles only when Circle's message for this burn names the customer's perps balance and is forwarded, and Hyperliquid's ledger shows the credit for at least the minimum (`verifyCctpDeposit`, see [money actions](money-actions.md)). It doesn't wait for the Base block to be final: Circle's fast transfer has already paid out, so a confirmed credit is the end. A mismatch or failure still waits for finality before the action fails. HyperCore's ledger hash is its own, so the credit is matched by amount, recipient, and time. Hyperliquid needs at least 5 USDC to arrive, so the minimum deposit is 6 USDC.
2. **Set up.** `POST /api/perps/setup` creates the trading key and returns `approveAgent` for the passkey; `POST /api/perps/signatures` sends it. Hyperliquid accepts this only after the first deposit. The trading key then puts the account in standard mode (`agentSetAbstraction`), where each dex keeps its own USDC balance.
3. **Trade.** `POST /api/perps/trade` takes what the customer picks: market, long or short, a dollar margin, leverage, cross or isolated, market or limit, and an optional take profit and stop loss. It sets the market's leverage and margin mode, moves margin into a stock market's dex if that dex is short (`agentSendAsset`, which only moves money within the account), then places the order with the auto-close orders attached. `POST /api/perps/trade/preview` returns the size, notional, margin, and estimated liquidation price without placing anything. `/positions/tpsl` sets auto-close on an open position; `/orders`, `/orders/cancel`, `/positions/close`, and `/leverage` cover the rest. The trading key signs each one; no passkey is needed. Market orders are immediate-or-cancel at the mid price ± 1%, as Hyperliquid's own SDKs place them. Orders under $10 are refused unless reduce-only.
4. **Withdraw.** `POST /api/perps/withdraw` asks the customer's wallet to sign `sendToEvmWithData`, which Circle's CCTP delivers as USDC to the same address on Base.

Markets include Hyperliquid's own and the HIP-3 dexes margined in USDC (stock perps such as `xyz:SPCX`), with sports screened out by dex and market name. An order's asset ID for a HIP-3 market is `100000 + dex index × 10000 + index`. Estimated liquidation prices use Hyperliquid's documented formula with a maintenance rate of 1 / (2 × max leverage); margin tiers for very large positions aren't modelled.

`GET /api/perps/markets` lists markets and prices (public; an isolate reuses the list for 5 seconds, since listing every dex spends Hyperliquid's per-IP budget). `GET /api/perps/account` reads margin per dex, positions, open orders, and fills. `GET /api/perps/candles?coin=&range=` returns chart candles for Live, 1H, 1D, 1W, 1M, 3M, 1Y, or All, and `GET /api/perps/book?coin=` returns the order book and spread; both are public, read Hyperliquid on each request, and check the coin against the cached market list so polling costs one read. The trade preview also estimates the fee from the account's own Hyperliquid rate (`userFees`, after its referral discount), doubled for stock markets, whose deployer takes half; it shows as unavailable if Hyperliquid doesn't answer. Aura adds no fee.

## Predictions on Polymarket

1. **Set up.** `POST /api/predictions/setup` takes one step per call: deploy the Deposit Wallet through Polymarket's relayer (Aura's builder key pays the gas), then the wallet's contract approvals (one passkey), then the order-book sign-in (one passkey). The order-book key is sealed and stored.
2. **Add money.** `POST /api/predictions/deposit` prepares a transfer of Base USDC to the wallet's Polymarket bridge address, which credits it as pUSD. It is the customer's own money moving between their accounts, so it doesn't count toward the daily limit; `predictions` gates it.
3. **Trade.** `POST /api/predictions/orders/buy` prices a dollar amount against the book and returns the order for the passkey, with the estimated shares and the payout if it wins. `/orders/sell` sells shares at the best bid less 2%. `POST /api/predictions/signatures` posts the signed order. `/orders/cancel` cancels a resting one.
4. **Withdraw and collect.** `/withdraw` sends pUSD to a bridge address that pays out USDC on Base to the account. `/redeem` collects a resolved market's winnings. Both are wallet batches signed with the passkey.

`/events`, `/up-or-down`, `/markets/[id]`, and `/history` read Polymarket's public data. `/markets/[id]` takes a Gamma market id or a market slug, since Polymarket's positions name their market by slug. Sports and esports are filtered twice: Gamma excludes the Sports tag, then every event and market is checked again for sports and esports tags, game IDs, and team IDs (`isSports`). A sports market answers as not found.

## Screens

`/app/markets` shows Perps and Predictions as a segmented control (`?view=predictions` opens the second). `/app/markets/perps/[coin]` is a perp's page (a stock perp's coin is URL-encoded, such as `xyz%3ASPCX`, and shown without its dex), and `/app/markets/predictions/[id]` a prediction market's, by Gamma id or slug. Components are in `apps/web/src/components/` (`markets-*.ts(x)`, `perps-*.tsx`, `prediction*-*.tsx`), pure helpers in `lib/markets/view.ts`, and styles in `src/app/markets.css` (`mk`).

- **A perp's page** is a trading screen. Desktop: a breadcrumb (Perps / Crypto or Stocks / the market, whose name opens a list to switch market), the price with the day's change in dollars and percent, volume, open interest, and funding; the chart (`/api/perps/candles`, ranges Live to All, line or candles; Live polls every 3 seconds); positions, open orders, and history; the order book (`/api/perps/book`, polled every 2.5 seconds, asks above the spread and bids below, each row with a depth bar); and the order panel, always open. Under 1280px the book moves under the chart, and under 1024px everything is one column. Phone: the book is a tab beside positions, and Long and Short open the same form in a sheet.
- **The order form** (`PerpsOrderForm`, shared by the panel and the sheet): Market or Limit, Cross or Isolated, Long or Short, a dollar amount with 25%, 50%, 75%, and Max of what's available (perps balance plus Base USDC, less a dollar), leverage by slider or number up to the market's maximum, and an optional take profit and stop loss. Position size, margin, estimated fee, and liquidation price come from `/api/perps/trade/preview`; a `null` fee shows as unavailable. The button says what the tap does: "Add money and long" when the perps balance is short, otherwise "Long BTC".
- **One tap.** The order form runs every step the customer still needs, in place: if the perps balance is short, a deposit of the shortfall plus $1 (at least the $6 minimum), waited on until the action settles; then setup and its one passkey signature if the trading key isn't approved; then the trade. Predictions does the same: each setup step until `ready`, a deposit of the shortfall if pUSD cash is short (raised to the bridge's minimum when it refuses a smaller one), a wait until the cash shows on Polymarket, then the buy, signed with the passkey and posted to `/signatures`. A cancelled passkey stops the steps and says nothing more was sent.
- **Reads.** Each panel shows its source and read time. A failed read shows as unavailable, never as the last value. With a switch off, the API answers `feature_unavailable` and the page says the area isn't available yet.
- **Guests** see labelled example markets and accounts (`lib/example/markets.ts`) and sign in to trade.
- **Prices.** A buy is priced at the best ask, else the midpoint. The order sheet's liquidation price comes from `/api/perps/trade/preview`, never the browser.
- Markets isn't in the app's navigation yet: the shell's icon map needs a `Markets` entry first. The old `/app/markets` redirect to Swap is gone.

## Configuration

- `MARKETS_CREDENTIAL_KEY` (secret): 32 random bytes, base64.
- `POLYMARKET_BUILDER_API_KEY`, `POLYMARKET_BUILDER_SECRET`, `POLYMARKET_BUILDER_PASSPHRASE` (secrets) and `POLYMARKET_BUILDER_CODE` (variable), from Polymarket's builder settings.
- The Privy app must allow server wallets, for trading keys.

## Not done yet

- Polymarket session keys, so an order needs no passkey. They need Polymarket to approve the builder key.
- Live checks on dev with real funds. The migration and secrets are on dev (3 October 2026); the code reaches dev when this merges. Signing was checked against Hyperliquid's live API with throwaway keys (its errors named exactly the signing address), and the CCTP burn was simulated on Base; fills, margin moves, and a real deposit are not yet checked.
- The fee estimate assumes a market order pays the taker rate and that stock markets charge double; a dex in Hyperliquid's growth mode charges less.
- A navigation entry for Markets (see Screens).
- The Culture category reads Polymarket's `pop-culture` tag, which isn't yet checked against live Gamma data.
