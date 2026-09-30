type ServiceState = "available" | "setup_required" | "locked";

type MoneyCapability = {
  key: "ach" | "wire" | "fednow" | "crypto";
  label: string;
  direction: "in" | "out" | "both";
  state: ServiceState;
  timing: string;
};

export type MoneyAccount = {
  state: "setup_required" | "pending" | "active";
  currency: "USD";
  accountName: string;
  accountNumberLastFour?: string;
  routingNumberLastFour?: string;
  depositInstructions?: {
    bankName: string;
    bankAddress?: string;
    beneficiaryName: string;
    beneficiaryAddress?: string;
    accountNumber: string;
    routingNumber: string;
    rails: Array<"ach" | "wire" | "fednow">;
  };
  capabilities: MoneyCapability[];
};

export const moneyCapabilities: MoneyCapability[] = [
  { key: "ach", label: "Bank Transfer", direction: "in", state: "setup_required", timing: "Provider timing" },
  { key: "wire", label: "Wire Transfer", direction: "in", state: "setup_required", timing: "Provider timing" },
  { key: "fednow", label: "Instant Transfer", direction: "in", state: "setup_required", timing: "Provider timing" },
  { key: "crypto", label: "Digital Assets", direction: "both", state: "available", timing: "Timing varies" }
];

export function previewMoneyAccount(displayName?: string): MoneyAccount {
  return {
    state: "setup_required",
    currency: "USD",
    accountName: displayName || "Aura member",
    capabilities: moneyCapabilities
  };
}
