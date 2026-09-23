// A market observation is not an execution price or a trading authorization.
export const REVIEWED_PRICE_ALERT_PAIR = {
  pairId: "ETH/USD",
  baseAssetId: "8453:native",
  quoteAssetId: "iso4217:USD",
  quoteCurrency: "USD",
  mappingVersion: "kraken-posttrade-eth-usd-v1"
} as const;
