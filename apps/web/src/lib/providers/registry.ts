import { bridgeWebhooks } from "./bridge/webhooks";
import { privyWebhooks } from "./privy/webhooks";
import { rainWebhooks } from "./rain/webhooks";
import type { WebhookProvider } from "./webhooks";

export const webhookProviders: Record<string, WebhookProvider> = { bridge: bridgeWebhooks, privy: privyWebhooks, rain: rainWebhooks };
