import type { MoneyAccount } from "./service-catalog";
import { moneyCapabilities } from "./service-catalog";

type BridgeVirtualAccount = {
  id: string;
  customer_id?: string;
  status?: string;
  source_deposit_instructions?: {
    currency?: string;
    payment_rails?: string[];
    bank_name?: string;
    bank_address?: string;
    bank_beneficiary_name?: string;
    bank_beneficiary_address?: string;
    bank_account_number?: string;
    bank_routing_number?: string;
  };
};

export class BridgeRailAdapter {
  readonly name = "bridge";
  private readonly baseUrl: string;

  constructor(private readonly apiKey: string, baseUrl = "https://api.bridge.xyz/v0") {
    this.baseUrl = baseUrl.replace(/\/$/, "");
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: { "Api-Key": this.apiKey, "Content-Type": "application/json", ...(init?.headers ?? {}) }
    });
    if (!response.ok) throw new Error(`Bridge request failed (${response.status}).`);
    return response.json() as Promise<T>;
  }

  async getUsdAccount(customerId: string): Promise<MoneyAccount> {
    // Bridge defaults to ten results, which can hide an older active account.
    const result = await this.request<{ data?: BridgeVirtualAccount[] }>(`/customers/${encodeURIComponent(customerId)}/virtual_accounts?limit=100`);
    if (!Array.isArray(result.data)) throw new Error("Bridge virtual account response is incomplete.");
    const account = result.data.find((item) => item.customer_id === customerId && item.status === "activated" && item.source_deposit_instructions?.currency?.toLowerCase() === "usd")
      ?? result.data.find((item) => item.customer_id === customerId && item.source_deposit_instructions?.currency?.toLowerCase() === "usd");
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
}
