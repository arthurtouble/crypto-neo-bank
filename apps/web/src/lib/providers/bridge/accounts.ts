import { z } from "zod";
import type { MoneyAccount } from "../service-catalog";
import { moneyCapabilities } from "../service-catalog";
import type { BridgeClient } from "./client";

const virtualAccountSchema = z.object({
  id: z.string(),
  customer_id: z.string().optional(),
  status: z.string().optional(),
  source_deposit_instructions: z.object({
    currency: z.string().optional(),
    payment_rails: z.array(z.string()).optional(),
    bank_name: z.string().optional(),
    bank_address: z.string().optional(),
    bank_beneficiary_name: z.string().optional(),
    bank_beneficiary_address: z.string().optional(),
    bank_account_number: z.string().optional(),
    bank_routing_number: z.string().optional()
  }).passthrough().optional()
}).passthrough();
type BridgeVirtualAccount = z.infer<typeof virtualAccountSchema>;
const pageSchema = z.object({ data: z.array(virtualAccountSchema) }).passthrough();

/**
 * Open a USD account for the customer whose deposits Bridge converts to USDC
 * and sends to their Aura smart wallet on Base.
 */
export async function openUsdAccount(bridge: BridgeClient, customerId: string, wallet: string): Promise<void> {
  await bridge.request(`/customers/${encodeURIComponent(customerId)}/virtual_accounts`, virtualAccountSchema, {
    method: "POST", idempotencyKey: `usd-account:${customerId}:${wallet.toLowerCase()}`,
    body: { source: { currency: "usd" }, destination: { currency: "usdc", payment_rail: "base", address: wallet } }
  });
}

/** The customer's USD account and deposit instructions, if Bridge has activated one. */
export async function getUsdAccount(bridge: BridgeClient, customerId: string): Promise<MoneyAccount> {
  // Bridge lists newest first, with at most 100 records per page. An older
  // activated USD account must not disappear behind newer accounts.
  let account: BridgeVirtualAccount | undefined;
  let cursor: string | undefined;
  let foundUsable = false;
  const seen = new Set<string>();
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ limit: "100", ...(cursor ? { starting_after: cursor } : {}) });
    const result = await bridge.request(`/customers/${encodeURIComponent(customerId)}/virtual_accounts?${query}`, pageSchema);
    for (const item of result.data) {
      if (item.customer_id !== customerId || item.source_deposit_instructions?.currency?.toLowerCase() !== "usd") continue;
      const source = item.source_deposit_instructions;
      const usable = item.status === "activated" && Boolean(source.bank_name?.trim() && source.bank_beneficiary_name?.trim()
        && source.bank_account_number?.trim() && source.bank_routing_number?.trim()
        && source.payment_rails?.some((rail) => ["ach_push", "wire", "fednow"].includes(rail)));
      if (usable) { account = item; foundUsable = true; break; }
      if (!account && item.status !== "deactivated") account = item;
    }
    if (foundUsable) break;
    if (result.data.length === 0) break;
    const lastId = result.data.at(-1)?.id;
    if (!lastId || seen.has(lastId)) throw new Error("Bridge virtual account cursor is incomplete.");
    seen.add(lastId);
    cursor = lastId;
    if (page === 19) throw new Error("Bridge virtual account list exceeds review limit.");
  }
  const source = account?.source_deposit_instructions;
  const complete = account?.status === "activated" && Boolean(source?.bank_name?.trim() && source.bank_beneficiary_name?.trim()
    && source.bank_account_number?.trim() && source.bank_routing_number?.trim() && Array.isArray(source.payment_rails));
  const rails = complete ? (["ach", "wire", "fednow"] as const).filter((key) => source!.payment_rails!.includes({ ach: "ach_push", wire: "wire", fednow: "fednow" }[key])) : [];
  const instructions = complete && rails.length ? {
    bankName: source!.bank_name!.trim(), bankAddress: source!.bank_address?.trim(),
    beneficiaryName: source!.bank_beneficiary_name!.trim(), beneficiaryAddress: source!.bank_beneficiary_address?.trim(),
    accountNumber: source!.bank_account_number!.trim(), routingNumber: source!.bank_routing_number!.trim(), rails: [...rails]
  } : undefined;
  return {
    state: account ? instructions ? "active" : "pending" : "setup_required",
    currency: "USD",
    accountName: instructions?.beneficiaryName ?? "Aura member",
    accountNumberLastFour: instructions?.accountNumber.slice(-4),
    routingNumberLastFour: instructions?.routingNumber.slice(-4),
    depositInstructions: instructions,
    capabilities: moneyCapabilities.map((capability) => ({ ...capability,
      state: capability.key === "crypto" ? "available" : !account ? "setup_required" : instructions?.rails.includes(capability.key) ? "available" : "locked" }))
  };
}
