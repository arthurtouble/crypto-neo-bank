import type { MoneyAccount } from "./service-catalog";
import { moneyCapabilities } from "./service-catalog";

type BridgeVirtualAccount = {
  id: string;
  status?: string;
  source?: { currency?: string };
  account?: { last_4?: string; routing_number_last_4?: string };
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

  async getUsdAccount(customerId: string, displayName: string): Promise<MoneyAccount> {
    const result = await this.request<{ data?: BridgeVirtualAccount[] } | BridgeVirtualAccount[]>(`/customers/${encodeURIComponent(customerId)}/virtual_accounts`);
    const accounts = Array.isArray(result) ? result : result.data ?? [];
    const account = accounts.find((item) => item.source?.currency?.toLowerCase() === "usd") ?? accounts[0];
    return {
      state: account ? (account.status === "activated" || account.status === "active" ? "active" : "pending") : "setup_required",
      currency: "USD",
      accountName: displayName,
      accountNumberLastFour: account?.account?.last_4,
      routingNumberLastFour: account?.account?.routing_number_last_4,
      capabilities: moneyCapabilities.map((capability) => ({ ...capability, state: capability.key === "crypto" ? "available" : account ? "locked" : "setup_required" }))
    };
  }
}
