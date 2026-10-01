"use client";

import { useAuth } from "@/lib/client/auth";
import { useQuery } from "@tanstack/react-query";
import { useApi } from "@/lib/client/api";
import type { MoneyAccount } from "@/lib/providers/service-catalog";

/** The response of GET /api/money/account. Bridge is the authority for everything in it. */
export type BankAccountState = {
  available: boolean;
  account: MoneyAccount;
  verification?: { status: string; kycStatus: string | null };
  nextAction: { type: "start_verification" } | { type: "continue_verification"; url: string } | null;
};

export type BankStage = "unavailable" | "start" | "continue" | "reviewing" | "rejected" | "active";

export function bankStage(state: BankAccountState): BankStage {
  if (!state.available) return "unavailable";
  if (state.nextAction?.type === "start_verification") return "start";
  if (state.nextAction?.type === "continue_verification") return "continue";
  if (state.account.state === "active" && state.account.depositInstructions) return "active";
  const status = `${state.verification?.status ?? ""} ${state.verification?.kycStatus ?? ""}`;
  if (/rejected|denied|failed/i.test(status)) return "rejected";
  return "reviewing";
}

/** The customer's bank account, shared by the Deposit and Send panels. */
export function useBankAccount() {
  const { user } = useAuth();
  const api = useApi();
  return useQuery<BankAccountState>({
    queryKey: ["money-account", user?.id],
    queryFn: () => api<BankAccountState>("/api/money/account"),
    enabled: Boolean(user)
  });
}
