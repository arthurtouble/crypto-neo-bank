import type { ActionView } from "@/lib/client/use-action";
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

const exampleAction = (id: string, kind: ActionView["kind"], summary: Record<string, unknown>, usdCents: number, created: string): ActionView & { createdAt: string } => ({
  id, kind, chainId: 8453, status: "confirmed", summary, usdCents, transactionHash: null, destinationChainId: null,
  destinationTransactionHash: null, failureReason: null, createdAt: created
});

export const exampleActions = [
  exampleAction("example-1", "transfer", { symbol: "USDC", amount: "120", to: "0x000000000000000000000000000000000000e0b2" }, 12000, "2026-01-14T18:20:00.000Z"),
  exampleAction("example-2", "route", { from: { symbol: "USDC", decimals: 6 }, to: { symbol: "cbBTC", decimals: 8 }, fromAmountRaw: "500000000", toAmountRaw: "830000" }, 50000, "2026-01-12T09:05:00.000Z"),
  exampleAction("example-3", "earn", { protocol: "aave", direction: "deposit", symbol: "USDC", amount: "1000" }, 100000, "2026-01-08T15:40:00.000Z")
];

export const exampleSecurityPolicy = {
  accountLocked: false, enforceAddressBook: false, dailyLimitUsd: null, newAddressDelayHours: 4, policyVersion: 1, updatedAt: at, enforcement: "aura" as const
};

export const exampleRecipients = [
  { id: "example-recipient", kind: "wallet" as const, name: "Sam (example)", destination: "0x000000000000000000000000000000000000e0b2", detail: "0x0000…e0b2", verified: true }
];

export const exampleMoneyAccount = { available: false, account: null, nextAction: null };
