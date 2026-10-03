import { FeatureUnavailableError } from "@/lib/http/errors";

export const featureKeys = ["direct_transfers", "swaps", "cross_chain", "defi_actions", "fiat_accounts", "payment_cards", "card_wallets", "card_deposits", "perps", "predictions"] as const;
export type FeatureKey = (typeof featureKeys)[number];

const safeDefaults: Record<FeatureKey, boolean> = {
  direct_transfers: false,
  swaps: false,
  cross_chain: false,
  defi_actions: false,
  fiat_accounts: false,
  payment_cards: false,
  card_wallets: false,
  card_deposits: false,
  perps: false,
  predictions: false
};

export { FeatureUnavailableError };

export async function featureEnabled(database: D1Database, key: FeatureKey): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM feature_flags WHERE flag_key = ?").bind(key).first<{ enabled: number }>();
  return row ? Boolean(row.enabled) : safeDefaults[key];
}

export async function requireFeature(database: D1Database, key: FeatureKey): Promise<void> {
  if (!await featureEnabled(database, key)) throw new FeatureUnavailableError(key);
}
