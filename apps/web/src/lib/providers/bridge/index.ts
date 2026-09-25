import { featureEnabled } from "@/lib/features/flags";
import { BridgeClient } from "./client";

export { BridgeClient, BridgeError } from "./client";
export { getUsdAccount, openUsdAccount } from "./accounts";
export { readOnboarding, startOnboarding } from "./onboarding";
export { createPayout } from "./payouts";
export { addBankAccount, bankAccountInputSchema } from "./bank-accounts";

/**
 * Bridge is on only when its feature switch is on and its API key is
 * installed. Turning it on after approval is: set the secret, flip the switch.
 */
export async function bridgeClient(db: D1Database): Promise<BridgeClient | null> {
  if (!process.env.BRIDGE_API_KEY || !await featureEnabled(db, "fiat_accounts")) return null;
  return new BridgeClient(process.env.BRIDGE_API_KEY, process.env.BRIDGE_API_BASE_URL);
}
