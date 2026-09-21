export const featureKeys = ["direct_transfers", "cross_chain", "defi_actions", "concierge", "membership_preview", "tokenized_markets", "fiat_accounts", "payment_cards"] as const;
export type FeatureKey = (typeof featureKeys)[number];

const safeDefaults: Record<FeatureKey, boolean> = {
  direct_transfers: true,
  cross_chain: true,
  defi_actions: true,
  concierge: true,
  membership_preview: true,
  tokenized_markets: false,
  fiat_accounts: false,
  payment_cards: false
};

export class FeatureUnavailableError extends Error {
  constructor(public feature: FeatureKey) { super("This feature is temporarily unavailable."); this.name = "FeatureUnavailableError"; }
}

export async function featureEnabled(database: D1Database, key: FeatureKey): Promise<boolean> {
  const row = await database.prepare("SELECT enabled FROM feature_flags WHERE flag_key = ?").bind(key).first<{ enabled: number }>();
  return row ? Boolean(row.enabled) : safeDefaults[key];
}

export async function requireFeature(database: D1Database, key: FeatureKey): Promise<void> {
  if (!await featureEnabled(database, key)) throw new FeatureUnavailableError(key);
}

