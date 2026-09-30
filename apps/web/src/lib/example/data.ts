import type { ActivityEntry } from "@/lib/activity/entries";
import type { CardState } from "@/lib/cards/service";
import type { Overview } from "@/lib/overview/read";

/**
 * Fictional data for guests, in exactly the shape the API returns, so every
 * screen renders the same way signed in or out. Screens must show the example
 * label whenever a query reports `isExample`. Addresses and hashes are
 * obviously fake, never real accounts.
 */
const at = "2026-01-15T12:00:00.000Z";
const exampleWallet = "0x000000000000000000000000000000000000e0a1";

export const exampleOverview: Overview = {
  wallet: exampleWallet,
  observedAt: at,
  holdings: [
    { id: "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", group: "cash", label: "USD Coin", symbol: "USDC", decimals: 6, source: "example", status: "observed", amountRaw: "8420000000", usdCents: 842000, observedAt: at },
    { id: "aave:8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913", group: "earn", label: "Aave USDC", symbol: "USDC", decimals: 6, source: "example", status: "observed", amountRaw: "2650000000", usdCents: 265000, observedAt: at },
    { id: "8453:0xcbb7c0000ab88b473b1f5afd9ef808440eed33bf", group: "crypto", label: "Bitcoin (Coinbase Wrapped BTC)", symbol: "cbBTC", decimals: 8, source: "example", status: "observed", amountRaw: "12000000", usdCents: 720000, observedAt: at },
    { id: "8453:native", group: "crypto", label: "Ether", symbol: "ETH", decimals: 18, source: "example", status: "observed", amountRaw: "2870000000000000000", usdCents: 718000, observedAt: at },
    { id: "8453:0xb200000000000000000000c2e324d24d7eecd1fb", group: "stocks", label: "Apple", symbol: "AAPLc", decimals: 8, source: "example", status: "observed", amountRaw: "1200000000", usdCents: 409800, observedAt: at },
    { id: "1:0x68749665ff8d2d112fa859aa293f07a622782f38", group: "metals", label: "Tether Gold", symbol: "XAUt", decimals: 6, source: "example", status: "observed", amountRaw: "500000", usdCents: 214000, observedAt: at }
  ],
  totals: { cash: { usdCents: 842000, partial: false }, crypto: { usdCents: 1438000, partial: false }, stocks: { usdCents: 409800, partial: false },
    metals: { usdCents: 214000, partial: false }, earn: { usdCents: 265000, partial: false }, all: { usdCents: 3168800, partial: false } }
};

export const exampleSecurityPolicy = {
  accountLocked: false, enforceAddressBook: false, dailyLimitUsd: null, newAddressDelayHours: 4, policyVersion: 1, updatedAt: at, enforcement: "aura" as const
};

export const exampleRecipients = [
  { id: "example-recipient", kind: "wallet" as const, name: "Sam (example)", destination: "0x000000000000000000000000000000000000e0b2", detail: "0x0000…e0b2", verified: true }
];

export const exampleMoneyAccount = { available: false, account: null, nextAction: null };

/** A few fictional transactions, for the Overview's recent list. */
export const exampleActivity: ActivityEntry[] = [
  { id: "example-received", origin: "incoming", type: "received", status: "completed", createdAt: "2026-01-15T11:40:00.000Z", chainId: 8453,
    asset: "USDC", amount: "500", counterparty: "0x000000000000000000000000000000000000e0b2", source: "example" },
  { id: "example-card", origin: "card", type: "card_payment", status: "completed", createdAt: "2026-01-15T09:12:00.000Z", chainId: 8453,
    asset: "USDC", amount: "12.40", counterparty: "Corner Cafe", source: "example" },
  { id: "example-sent", origin: "aura", type: "sent", status: "completed", createdAt: "2026-01-14T18:05:00.000Z", chainId: 8453,
    asset: "USDC", amount: "250", counterparty: "0x000000000000000000000000000000000000e0b2", source: "example" }
];

/** A fictional card, for the guest Cards page: no real card number, key, or merchant. */
export const exampleCard: Extract<CardState, { state: "card" }> = {
  state: "card",
  card: { id: "example-card", lastFour: "1000", brand: "visa", status: "active", expMonth: 9, expYear: 2029, dailyLimitUsd: 500, wallets: { applePay: false, googlePay: false } },
  allowance: { status: "available", allowanceUsd: "37.50", balanceUsd: "1825.50", spender: "0x000000000000000000000000000000000000e0c3", observedAt: at },
  activity: [
    { id: "example-card-1", kind: "payment", status: "completed", amountUsd: "12.00", merchant: "Corner Cafe", createdAt: "2026-01-15T09:12:00.000Z",
      transactionId: null, disputable: false, dispute: null, transactionHash: null, authorizationId: null },
    { id: "example-card-2", kind: "payment", status: "completed", amountUsd: "30.00", merchant: "Bookshop", createdAt: "2026-01-14T16:40:00.000Z",
      transactionId: null, disputable: false, dispute: null, transactionHash: null, authorizationId: null },
    { id: "example-card-3", kind: "payment", status: "declined", amountUsd: "400.00", merchant: "Electronics", createdAt: "2026-01-14T11:05:00.000Z",
      transactionId: null, disputable: false, dispute: null, transactionHash: null, authorizationId: null }
  ],
  activityStatus: "available", publishableKey: null, walletsEnabled: false, observedAt: at
};

/** When the example insights are "read": they're built from exampleInsightActivity as of this date. */
export const exampleInsightsNow = new Date(at);

/** A fictional year of completed activity, valued in dollars, for the guest Insights page. */
export const exampleInsightActivity: ActivityEntry[] = ([
  ["received", "2026-01-15T11:40:00.000Z", "500", 500, "0x000000000000000000000000000000000000e0b2"],
  ["card_payment", "2026-01-15T09:12:00.000Z", "12.40", 12.4, "Corner Cafe"],
  ["sent", "2026-01-14T18:05:00.000Z", "250", 250, "0x000000000000000000000000000000000000e0b2"],
  ["card_payment", "2026-01-12T16:40:00.000Z", "30", 30, "Bookshop"],
  ["earn_deposit", "2026-01-09T10:00:00.000Z", "155", 155, "Aave"],
  ["card_payment", "2026-01-06T08:30:00.000Z", "7.60", 7.6, "Corner Cafe"],
  ["received", "2026-01-02T12:00:00.000Z", "1200", 1200, "0x000000000000000000000000000000000000e0b2"],
  ["swap", "2025-12-28T15:20:00.000Z", "100", 100, undefined],
  ["card_payment", "2025-12-20T19:10:00.000Z", "64", 64, "Grocer"],
  ["sent", "2025-12-12T09:00:00.000Z", "180", 180, "0x000000000000000000000000000000000000e0b2"],
  ["received", "2025-11-30T12:00:00.000Z", "900", 900, "0x000000000000000000000000000000000000e0b2"],
  ["card_payment", "2025-10-18T13:45:00.000Z", "42", 42, "Bookshop"],
  ["received", "2025-09-01T12:00:00.000Z", "650", 650, "0x000000000000000000000000000000000000e0b2"],
  ["sent", "2025-06-10T12:00:00.000Z", "320", 320, "0x000000000000000000000000000000000000e0b2"]
] as const).map(([type, createdAt, amount, estimatedUsd, counterparty], index) => ({
  id: `example-insight-${index}`, origin: type === "card_payment" ? "card" : type === "received" ? "incoming" : "aura", type, status: "completed",
  createdAt, chainId: 8453, asset: "USDC", amount, estimatedUsd, counterparty, source: "example"
}));
