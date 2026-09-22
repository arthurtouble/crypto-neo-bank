export type ServiceState = "available" | "setup_required" | "locked";

export type MoneyCapability = {
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
  capabilities: MoneyCapability[];
};

export type BenefitService = {
  key: "rewards" | "lounges" | "esim" | "travel_protection" | "concierge";
  name: string;
  summary: string;
  state: ServiceState;
  action: string;
};

export const moneyCapabilities: MoneyCapability[] = [
  { key: "ach", label: "Bank Transfer", direction: "both", state: "setup_required", timing: "1–3 business days" },
  { key: "wire", label: "Wire Transfer", direction: "both", state: "setup_required", timing: "Same business day" },
  { key: "fednow", label: "Instant Transfer", direction: "both", state: "setup_required", timing: "Usually within minutes" },
  { key: "crypto", label: "Digital Assets", direction: "both", state: "available", timing: "Timing varies" }
];

export const benefitServices: BenefitService[] = [
  { key: "rewards", name: "Everyday Rewards", summary: "Offers matched to eligible purchases.", state: "setup_required", action: "Explore Offers" },
  { key: "lounges", name: "Airport Lounges", summary: "Lounge access for eligible members.", state: "setup_required", action: "View Access" },
  { key: "esim", name: "Global Data", summary: "Travel data in supported countries.", state: "setup_required", action: "Choose a Plan" },
  { key: "travel_protection", name: "Travel Protection", summary: "Cover options shown before purchase.", state: "setup_required", action: "Check Cover" },
  { key: "concierge", name: "Lifestyle Concierge", summary: "Travel, dining, events, and requests.", state: "setup_required", action: "Make a Request" }
];

export function previewMoneyAccount(displayName?: string): MoneyAccount {
  return {
    state: "setup_required",
    currency: "USD",
    accountName: displayName || "Aurel Member",
    capabilities: moneyCapabilities
  };
}
