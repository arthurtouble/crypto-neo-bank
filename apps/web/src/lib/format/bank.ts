/** What customers call each way a bank can send dollars, the same words across the app. The public pay page uses the payer bank's own terms instead (ACH, Wire). */
export const bankRailNames = { ach: "Bank transfer", wire: "Wire", fednow: "Instant transfer" } as const;

export type BankRail = keyof typeof bankRailNames;
