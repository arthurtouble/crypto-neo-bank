import { featureEnabled } from "@/lib/features/flags";
import { BridgeClient } from "./client";

export { BridgeClient, BridgeError } from "./client";
export { getUsdAccount, openUsdAccount } from "./accounts";
export { readOnboarding, startOnboarding } from "./onboarding";
export { createPayout } from "./payouts";
export { addBankAccount, bankAccountInputSchema, removeBankAccount } from "./bank-accounts";
export { FAILED_PAYOUT_STATES, listBankDeposits, payoutStateText, readTransferState, TERMINAL_PAYOUT_STATES, type BankDeposit } from "./transfers";

/**
 * Bridge is on only when its feature switch is on and its API key is
 * installed. Turning it on after approval is: set the secret, flip the switch.
 */
export async function bridgeClient(db: D1Database): Promise<BridgeClient | null> {
  if (!process.env.BRIDGE_API_KEY || !await featureEnabled(db, "fiat_accounts")) return null;
  return new BridgeClient(process.env.BRIDGE_API_KEY, process.env.BRIDGE_API_BASE_URL);
}

/** The customer's Bridge customer ID once verification has passed, or null. */
export async function activeBridgeCustomer(db: D1Database, subject: string): Promise<string | null> {
  const link = await db.prepare("SELECT external_customer_id FROM provider_customer_links WHERE subject_reference = ? AND provider = 'bridge' AND status = 'active' AND external_customer_id IS NOT NULL")
    .bind(subject).first<{ external_customer_id: string }>();
  return link?.external_customer_id ?? null;
}
