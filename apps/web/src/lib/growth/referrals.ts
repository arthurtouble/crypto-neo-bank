export type ReferralEvidence = { accessActive: boolean; accountSecured: boolean; firstValueCompleted: boolean; retained: boolean; accountAgeDays: number; criticalIssueOpen: boolean; countryAllowed: boolean; featureEnabled: boolean; activeInvites: number; inviteLimit: number };
export function referralEligibility(evidence: ReferralEvidence) {
  const reasons: string[] = [];
  if (!evidence.featureEnabled) reasons.push("feature_paused");
  if (!evidence.accessActive) reasons.push("access_inactive");
  if (!evidence.accountSecured) reasons.push("account_not_secured");
  if (!evidence.firstValueCompleted) reasons.push("first_value_incomplete");
  if (!evidence.retained || evidence.accountAgeDays < 30) reasons.push("retention_incomplete");
  if (evidence.criticalIssueOpen) reasons.push("critical_issue_open");
  if (!evidence.countryAllowed) reasons.push("country_unavailable");
  if (evidence.activeInvites >= evidence.inviteLimit) reasons.push("invite_limit_reached");
  return { eligible: reasons.length === 0, reasons };
}
