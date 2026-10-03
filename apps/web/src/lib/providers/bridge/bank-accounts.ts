import { z } from "zod";
import { BridgeError, type BridgeClient } from "./client";

export const bankAccountInputSchema = z.strictObject({
  accountOwnerName: z.string().trim().min(2).max(120),
  bankName: z.string().trim().min(2).max(120),
  accountNumber: z.string().regex(/^\d{4,17}$/),
  routingNumber: z.string().regex(/^\d{9}$/),
  checkingOrSavings: z.enum(["checking", "savings"]),
  address: z.strictObject({
    streetLine1: z.string().trim().min(4).max(35), city: z.string().trim().min(2).max(80),
    state: z.string().trim().length(2), postalCode: z.string().trim().min(3).max(10), country: z.literal("USA")
  })
});
type BankAccountInput = z.infer<typeof bankAccountInputSchema>;

const externalAccountSchema = z.object({
  id: z.string(),
  account: z.object({ last_4: z.string().regex(/^\d{4}$/) }).passthrough().optional(),
  last_4: z.string().regex(/^\d{4}$/).optional(),
  bank_name: z.string().optional(),
  account_owner_name: z.string().optional(),
  active: z.boolean().optional()
}).passthrough();

type BankAccount = { id: string; lastFour: string; displayName: string };

/** Save a US bank account with Bridge. Aura keeps only Bridge's ID, the last four digits, and a display name. */
export async function addBankAccount(bridge: BridgeClient, customerId: string, input: BankAccountInput, requestId: string): Promise<BankAccount> {
  // Top-level account_number and routing_number are deprecated in Bridge's API; they go under `account`.
  const account = await bridge.request(`/customers/${encodeURIComponent(customerId)}/external_accounts`, externalAccountSchema, {
    method: "POST", idempotencyKey: `bank-account:${requestId}`,
    body: { currency: "usd", account_type: "us", bank_name: input.bankName, account_owner_name: input.accountOwnerName,
      account: { account_number: input.accountNumber, routing_number: input.routingNumber, checking_or_savings: input.checkingOrSavings },
      address: { street_line_1: input.address.streetLine1, city: input.address.city, state: input.address.state,
        postal_code: input.address.postalCode, country: input.address.country } }
  });
  const lastFour = account.account?.last_4 ?? account.last_4;
  if (!lastFour) throw new Error("Bridge returned a bank account without its last four digits.");
  return { id: account.id, lastFour, displayName: account.bank_name ?? input.bankName };
}

/** Delete a saved bank account at Bridge, so no payout can reach it. One Bridge no longer has counts as deleted. */
export async function removeBankAccount(bridge: BridgeClient, customerId: string, externalAccountId: string): Promise<void> {
  try {
    await bridge.request(`/customers/${encodeURIComponent(customerId)}/external_accounts/${encodeURIComponent(externalAccountId)}`, z.unknown(), { method: "DELETE" });
  } catch (error) {
    if (!(error instanceof BridgeError && error.status === 404)) throw error;
  }
}
