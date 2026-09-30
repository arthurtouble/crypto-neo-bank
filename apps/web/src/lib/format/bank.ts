/** What customers call each way a bank can send dollars. The same words everywhere: Deposit and the Aura tag payment page. */
export const bankRailNames = { ach: "Bank transfer", wire: "Wire", fednow: "Instant transfer" } as const;

export type BankRail = keyof typeof bankRailNames;
