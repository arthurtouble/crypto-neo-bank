export type PolicyState = { accountLocked: boolean; enforceAddressBook: boolean; dailyLimitCents: number | null; newAddressDelaySeconds: number };

/**
 * What in a change makes the account easier to move money out of, in words.
 * Tightening applies at once; loosening needs a fresh passkey, so a stolen
 * session can't undo a lock or a limit.
 */
export function loosening(current: PolicyState, next: PolicyState): string[] {
  const reasons: string[] = [];
  if (current.accountLocked && !next.accountLocked) reasons.push("unlock your account");
  if (current.enforceAddressBook && !next.enforceAddressBook) reasons.push("allow sending to any address");
  if (current.dailyLimitCents !== null && next.dailyLimitCents === null) reasons.push("remove your daily limit");
  else if (current.dailyLimitCents !== null && next.dailyLimitCents !== null && next.dailyLimitCents > current.dailyLimitCents) {
    reasons.push(`raise your daily limit to $${(next.dailyLimitCents / 100).toLocaleString("en-US")}`);
  }
  if (next.newAddressDelaySeconds < current.newAddressDelaySeconds) reasons.push(`shorten the wait for new recipients to ${next.newAddressDelaySeconds / 3600} hours`);
  return reasons;
}
