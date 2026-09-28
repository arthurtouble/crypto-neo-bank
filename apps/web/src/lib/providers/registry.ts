import { bridgeWebhooks } from "./bridge/webhooks";
import { privyWebhooks } from "./privy/webhooks";
import { stripeWebhooks } from "./stripe/webhooks";
import type { WebhookProvider } from "./webhooks";

export const webhookProviders: Record<string, WebhookProvider> = { bridge: bridgeWebhooks, privy: privyWebhooks, stripe: stripeWebhooks };
