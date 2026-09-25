import type { WebhookProvider } from "../webhooks";

/**
 * Rain's webhook signing scheme is implemented from Rain's documentation when
 * the card program is contracted. Until then every Rain delivery is rejected,
 * whatever its headers say.
 */
export const rainWebhooks: WebhookProvider = {
  name: "rain",
  secret: () => process.env.RAIN_WEBHOOK_SECRET,
  verify: async () => false,
  normalize: () => null
};
