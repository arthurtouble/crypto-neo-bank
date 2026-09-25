import { FeatureUnavailableError } from "@/lib/http/errors";

export const featureKeys = ["direct_transfers", "swaps", "cross_chain", "defi_actions", "support_assistant", "tokenized_markets", "fiat_accounts", "payment_cards"] as const;
export type FeatureKey = (typeof featureKeys)[number];

const safeDefaults: Record<FeatureKey, boolean> = {
  direct_transfers: false,
  swaps: false,
  cross_chain: false,
  defi_actions: false,
  support_assistant: false,
  tokenized_markets: false,
  fiat_accounts: false,
  payment_cards: false
};

export { FeatureUnavailableError };

export async function featureEnabled(database: D1Database, key: FeatureKey): Promise<boolean> {
  const row = await database.prepare("SELECT enabled, audience FROM feature_flags WHERE flag_key = ?").bind(key).first<{ enabled: number; audience: string }>();
  return row ? Boolean(row.enabled) && row.audience === "all" : safeDefaults[key];
}

export async function requireFeature(database: D1Database, key: FeatureKey): Promise<void> {
  if (!await featureEnabled(database, key)) throw new FeatureUnavailableError(key);
}
