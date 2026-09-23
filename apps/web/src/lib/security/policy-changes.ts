export type SecurityPolicyValues = {
  accountLocked: boolean;
  enforceAddressBook: boolean;
  dailyLimitUsd: number;
  newAddressThresholdUsd: number;
  newAddressDelaySeconds: number;
  stepUpThresholdUsd: number;
};

function valid(policy: SecurityPolicyValues): boolean {
  return typeof policy.accountLocked === "boolean" && typeof policy.enforceAddressBook === "boolean"
    && [policy.dailyLimitUsd, policy.newAddressThresholdUsd, policy.newAddressDelaySeconds, policy.stepUpThresholdUsd]
      .every((value) => Number.isFinite(value) && value >= 0);
}

/** Until exact-action step-up exists, an ordinary session may only tighten controls. */
export function policyRelaxationReasons(current: SecurityPolicyValues, next: SecurityPolicyValues): string[] {
  if (!valid(current)) return ["invalid_current_policy"];
  if (!valid(next)) return ["invalid_new_policy"];
  const reasons: string[] = [];
  if (current.accountLocked && !next.accountLocked) reasons.push("accountLocked");
  if (current.enforceAddressBook && !next.enforceAddressBook) reasons.push("enforceAddressBook");
  if (next.dailyLimitUsd > current.dailyLimitUsd) reasons.push("dailyLimitUsd");
  if (next.newAddressThresholdUsd > current.newAddressThresholdUsd) reasons.push("newAddressThresholdUsd");
  if (next.newAddressDelaySeconds < current.newAddressDelaySeconds) reasons.push("newAddressDelaySeconds");
  if (next.stepUpThresholdUsd > current.stepUpThresholdUsd) reasons.push("stepUpThresholdUsd");
  return reasons;
}
