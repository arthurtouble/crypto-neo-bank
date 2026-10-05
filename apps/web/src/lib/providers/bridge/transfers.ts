import { z } from "zod";
import type { BridgeClient } from "./client";

/**
 * Bridge's side of money moving between a bank and the customer's Aura
 * account. Bridge is the authority; Aura only reads these states to show them.
 */

const transferSchema = z.object({ id: z.string(), state: z.string() }).passthrough();

/** A payout's state at Bridge: awaiting_funds → funds_received → payment_submitted → payment_processed, or an exception. */
export async function readTransferState(bridge: BridgeClient, transferId: string): Promise<string> {
  return (await bridge.request(`/transfers/${encodeURIComponent(transferId)}`, transferSchema)).state;
}

/** States after which Bridge will not change a payout again. */
export const TERMINAL_PAYOUT_STATES = new Set(["payment_processed", "undeliverable", "returned", "missing_return_policy", "refunded", "refund_failed", "canceled", "error"]);
/** Terminal states where the money did not reach the bank. */
export const FAILED_PAYOUT_STATES = new Set(["undeliverable", "returned", "missing_return_policy", "refunded", "refund_failed", "canceled", "error"]);

/** A payout's Bridge state in words a customer understands. */
export function payoutStateText(state: string): string {
  const text: Record<string, string> = {
    awaiting_funds: "Waiting for your USDC to reach Bridge",
    in_review: "Bridge is reviewing this transfer",
    funds_received: "Bridge received your USDC",
    payment_submitted: "Sent to your bank",
    payment_processed: "Arrived at your bank",
    undeliverable: "Your bank couldn't accept it. The money is coming back to your Aura account",
    returned: "Your bank sent it back. The money is coming back to your Aura account",
    refund_in_flight: "The money is coming back to your Aura account",
    refunded: "Returned to your Aura account",
    refund_failed: "Bridge couldn't return the money. Contact support",
    missing_return_policy: "Bridge can't return the money yet. Contact support",
    canceled: "Canceled",
    error: "Bridge is looking into this transfer. Contact support"
  };
  return text[state] ?? "Bridge is working on this transfer";
}

const accountSchema = z.object({ id: z.string(), status: z.string().optional(),
  source_deposit_instructions: z.object({ currency: z.string().optional() }).passthrough().optional() }).passthrough();
const accountPage = z.object({ data: z.array(accountSchema) }).passthrough();
const activitySchema = z.object({
  id: z.string(), type: z.string(), amount: z.string().optional(), currency: z.string().optional(),
  destination_tx_hash: z.string().nullable().optional(), created_at: z.string().optional(),
  source: z.object({ payment_rail: z.string().optional(), sender_name: z.string().optional(), bank_name: z.string().optional() }).passthrough().optional()
}).passthrough();
const activityPage = z.object({ data: z.array(activitySchema) }).passthrough();

export type BankDeposit = { transactionHash: string; senderName: string | null; bankName: string | null; rail: string | null };

/**
 * The bank deposits Bridge delivered to the customer's account as USDC, keyed
 * by the Base transaction that delivered them, so Transactions can show them
 * as bank deposits and not as a transfer from Bridge's address.
 */
export async function listBankDeposits(bridge: BridgeClient, customerId: string, limit = 50): Promise<Map<string, BankDeposit>> {
  const accounts = await bridge.request(`/customers/${encodeURIComponent(customerId)}/virtual_accounts?limit=10`, accountPage);
  const deposits = new Map<string, BankDeposit>();
  for (const account of accounts.data.filter((item) => item.source_deposit_instructions?.currency?.toLowerCase() === "usd")) {
    const history = await bridge.request(`/customers/${encodeURIComponent(customerId)}/virtual_accounts/${encodeURIComponent(account.id)}/history?event_type=payment_processed&limit=${limit}`, activityPage);
    for (const item of history.data) {
      if (item.type !== "payment_processed" || !item.destination_tx_hash || !/^0x[0-9a-fA-F]{64}$/.test(item.destination_tx_hash)) continue;
      deposits.set(item.destination_tx_hash.toLowerCase(), { transactionHash: item.destination_tx_hash.toLowerCase(),
        senderName: item.source?.sender_name?.trim() || null, bankName: item.source?.bank_name?.trim() || null, rail: item.source?.payment_rail ?? null });
    }
  }
  return deposits;
}
