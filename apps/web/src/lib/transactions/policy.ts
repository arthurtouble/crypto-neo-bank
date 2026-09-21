export type TransactionIntentInput = {
  type: "transfer" | "swap" | "bridge" | "earn_supply" | "earn_withdraw" | "borrow" | "repay";
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
  enforceAllowlist: boolean;
  reserveFloorUsd: number;
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
  enforceAllowlist: false,
  reserveFloorUsd: 10_000,
  stepUpThresholdUsd: 10_000,
  delayThresholdUsd: 25_000,
  delaySeconds: 86_400
};

export function evaluateTransactionPolicy(
  input: TransactionIntentInput,
  policy: TransactionPolicy = defaultTransactionPolicy,
  now = new Date()
): PolicyDecision {
  const findings: PolicyFinding[] = [];
  const destination = input.destination.toLowerCase();
  const allowlisted = policy.allowlistedDestinations.map((item) => item.toLowerCase()).includes(destination);

  if (!policy.supportedChainIds.includes(input.chainId)) {
    findings.push({ code: "unsupported_chain", level: "block", message: "This network is not enabled for customer-directed transactions." });
  }
  if (!/^0x[a-f0-9]{40}$/i.test(input.destination) || /^0x0{40}$/i.test(input.destination)) {
    findings.push({ code: "invalid_destination", level: "block", message: "The destination is not a valid non-zero EVM address." });
  }
  if (!input.amount || Number(input.amount) <= 0 || !Number.isFinite(Number(input.amount))) {
    findings.push({ code: "invalid_amount", level: "block", message: "The transaction amount must be greater than zero." });
  }
  if (policy.enforceAllowlist && !allowlisted) {
    findings.push({ code: "destination_not_allowed", level: "block", message: "This wallet policy only permits saved destinations." });
  } else if (!allowlisted) {
    findings.push({ code: "new_destination", level: "warning", message: "This destination is not in the customer’s address book." });
  }
  if (input.estimatedUsd === undefined) {
    findings.push({ code: "value_unavailable", level: "warning", message: "USD value is unavailable; value-based controls cannot be evaluated." });
  }
  if (input.estimatedUsd !== undefined && input.availableUsd !== undefined && input.availableUsd - input.estimatedUsd < policy.reserveFloorUsd) {
    findings.push({ code: "reserve_below_target", level: "warning", message: "This action would move the immediately available balance below the configured reserve target." });
  }

  const requiresStepUp = input.estimatedUsd === undefined || input.estimatedUsd >= policy.stepUpThresholdUsd;
  const delayed = input.estimatedUsd !== undefined && input.estimatedUsd >= policy.delayThresholdUsd;
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

