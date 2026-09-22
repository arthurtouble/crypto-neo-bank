export type TransactionIntentInput = {
  type: "transfer" | "swap" | "bridge" | "earn_supply" | "earn_withdraw" | "earn_claim" | "borrow" | "repay";
  chainId: number;
  asset: string;
  amount: string;
  destination: string;
  estimatedUsd?: number;
  availableUsd?: number;
};

export type TransactionPolicy = {
  supportedChainIds: number[];
  allowlistedDestinations: string[];
  coolingDestinations: string[];
  enforceAllowlist: boolean;
  accountLocked: boolean;
  reserveFloorUsd: number;
  dailyLimitUsd: number;
  spentTodayUsd: number;
  newAddressThresholdUsd: number;
  stepUpThresholdUsd: number;
  delayThresholdUsd: number;
  delaySeconds: number;
};

export type PolicyFinding = { code: string; message: string; level: "block" | "warning" | "information" };
export type PolicyDecision = {
  permitted: boolean;
  requiresWalletConfirmation: true;
  requiresStepUp: boolean;
  releaseAt?: string;
  findings: PolicyFinding[];
};

export const defaultTransactionPolicy: TransactionPolicy = {
  supportedChainIds: [8453, 1, 42161, 10, 137],
  allowlistedDestinations: [],
  coolingDestinations: [],
  enforceAllowlist: false,
  accountLocked: false,
  reserveFloorUsd: 10_000,
  dailyLimitUsd: 25_000,
  spentTodayUsd: 0,
  newAddressThresholdUsd: 1_000,
  stepUpThresholdUsd: 10_000,
  delayThresholdUsd: 25_000,
  delaySeconds: 86_400
};

export function evaluateTransactionPolicy(
  input: TransactionIntentInput,
  policy: TransactionPolicy = defaultTransactionPolicy,
  now = new Date(),
  trustedUsdCents?: string
): PolicyDecision {
  const findings: PolicyFinding[] = [];
  const valueCents = trustedUsdCents && /^\d+$/.test(trustedUsdCents) ? BigInt(trustedUsdCents) : undefined;
  const validValue = valueCents !== undefined && valueCents > 0n && valueCents <= BigInt(Number.MAX_SAFE_INTEGER);
  const reaches = (thresholdUsd: number) => validValue && valueCents >= BigInt(Math.ceil(thresholdUsd * 100));
  const destination = input.destination.toLowerCase();
  const allowlisted = policy.allowlistedDestinations.map((item) => item.toLowerCase()).includes(destination);
  const cooling = policy.coolingDestinations.map((item) => item.toLowerCase()).includes(destination);

  if (policy.accountLocked) {
    findings.push({ code: "account_locked", level: "block", message: "Outgoing transactions are locked in your Safety center." });
  }

  if (!policy.supportedChainIds.includes(input.chainId)) {
    findings.push({ code: "unsupported_chain", level: "block", message: "This network is not enabled for customer-directed transactions." });
  }
  if (!/^0x[a-f0-9]{40}$/i.test(input.destination) || /^0x0{40}$/i.test(input.destination)) {
    findings.push({ code: "invalid_destination", level: "block", message: "The destination is not a valid non-zero EVM address." });
  }
  if (!input.amount || Number(input.amount) <= 0 || !Number.isFinite(Number(input.amount))) {
    findings.push({ code: "invalid_amount", level: "block", message: "The transaction amount must be greater than zero." });
  }
  if (input.type === "transfer" && cooling) {
    findings.push({ code: "destination_cooling", level: "block", message: "This saved destination is still in its security cooling period." });
  } else if (input.type === "transfer" && policy.enforceAllowlist && !allowlisted) {
    findings.push({ code: "destination_not_allowed", level: "block", message: "This wallet policy only permits saved destinations." });
  } else if (input.type === "transfer" && !allowlisted && reaches(policy.newAddressThresholdUsd)) {
    findings.push({ code: "new_destination_threshold", level: "block", message: "Save this destination and complete its cooling period before sending this amount." });
  } else if (input.type === "transfer" && !allowlisted) {
    findings.push({ code: "new_destination", level: "warning", message: "This destination is not in the customer’s address book." });
  }
  if (!validValue) {
    findings.push({ code: "value_unavailable", level: "block", message: "An independent USD valuation is required before this action can be reviewed." });
  }
  // A browser-provided availableUsd is not a verified balance, so reserve
  // compliance cannot be claimed from it.
  findings.push({ code: "reserve_unavailable", level: "information", message: "Reserve impact is unavailable until an independent balance is verified." });
  if (validValue && BigInt(Math.ceil(policy.spentTodayUsd * 100)) + valueCents > BigInt(Math.floor(policy.dailyLimitUsd * 100))) {
    findings.push({ code: "daily_limit_exceeded", level: "block", message: "This action exceeds your rolling 24-hour transaction limit." });
  }

  const requiresStepUp = !validValue || Boolean(reaches(policy.stepUpThresholdUsd));
  const delayed = Boolean(reaches(policy.delayThresholdUsd));
  const releaseAt = delayed ? new Date(now.getTime() + policy.delaySeconds * 1000).toISOString() : undefined;
  if (delayed) findings.push({ code: "large_transfer_delay", level: "information", message: "The configured large-transfer review period applies before submission." });

  return {
    permitted: !findings.some((finding) => finding.level === "block"),
    requiresWalletConfirmation: true,
    requiresStepUp,
    releaseAt,
    findings
  };
}
