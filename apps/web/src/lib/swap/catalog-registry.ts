import type { AssetId } from "@/lib/swap/assets";

export type CatalogRegistry = {
  verified: ReadonlySet<AssetId>;
  popular: ReadonlySet<AssetId>;
  denied: ReadonlySet<AssetId>;
  regulated: ReadonlySet<AssetId>;
};

// Reviewed identities only. A matching symbol, logo, or LI.FI listing confers no trust.
const verified = [
  "8453:native",
  "8453:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "8453:0x4200000000000000000000000000000000000006",
  "1:native",
  "1:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48",
  "42161:native",
  "42161:0xaf88d065e77c8cc2239327c5edb3a432268e5831",
  "10:native",
  "10:0x0b2c639c533813f4aa9d7837caf62653d097ff85",
  "137:native",
  "137:0x3c499c542cef5e3811e1192ce70d8cc03d5c3359"
] as const;

export const CATALOG_REGISTRY: CatalogRegistry = {
  verified: new Set(verified),
  popular: new Set(verified.slice(0, 3)),
  // No deny or regulated addresses have been approved for this registry yet.
  // Absence from these sets is not a legal or safety clearance; later quote
  // and execution checks must independently resolve eligibility.
  denied: new Set<AssetId>(),
  regulated: new Set<AssetId>()
};
