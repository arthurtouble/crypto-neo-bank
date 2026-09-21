import type { CardAccount, ComplianceStatus, Membership, ObservationStatus } from "./contracts";

export const demoScenarioIds = ["new_customer", "funded", "compliance_review", "transfer_failed"] as const;
export type DemoScenarioId = (typeof demoScenarioIds)[number];
export type DemoScenario = {
  id: DemoScenarioId; name: string; description: string; customerName: string; email: string; country: string;
  walletReady: boolean; passkeyReady: boolean; recoveryReady: boolean; complianceStatus: ComplianceStatus;
  requiredActions: string[]; cardStatus: CardAccount["status"]; liquidAmount: string; productiveAmount: string;
  connectedAmount: string; observationStatus: ObservationStatus; commandFailure?: { code: string; message: string }; membership: Membership;
};

const membership: Membership = {
  tier: "Black", score: 74, qualifyingBalance: "50000.00", renewalAt: "2026-10-21T00:00:00.000Z",
  entitlements: [
    { name: "Priority support", status: "available" },
    { name: "Airport lounge allocation", status: "planned" },
    { name: "Travel protection", status: "in_review" }
  ]
};

export const demoScenarios: Record<DemoScenarioId, DemoScenario> = {
  new_customer: { id: "new_customer", name: "New customer", description: "Explore onboarding before wallet and compliance activation.", customerName: "Alex Morgan", email: "alex@example.com", country: "PT", walletReady: false, passkeyReady: false, recoveryReady: false, complianceStatus: "not_started", requiredActions: ["Accept current terms", "Create a passkey", "Create a wallet"], cardStatus: "not_eligible", liquidAmount: "0.00", productiveAmount: "0.00", connectedAmount: "0.00", observationStatus: "confirmed", membership: { ...membership, tier: "Essential", score: 8 } },
  funded: { id: "funded", name: "Funded relationship", description: "A fully onboarded customer with fiat, onchain, card, and membership activity.", customerName: "Alex Morgan", email: "alex@example.com", country: "PT", walletReady: true, passkeyReady: true, recoveryReady: true, complianceStatus: "approved", requiredActions: [], cardStatus: "active", liquidAmount: "28450.18", productiveAmount: "112840.24", connectedAmount: "43000.00", observationStatus: "confirmed", membership },
  compliance_review: { id: "compliance_review", name: "Compliance review", description: "Regulated features are paused while the provider requests information.", customerName: "Alex Morgan", email: "alex@example.com", country: "PT", walletReady: true, passkeyReady: true, recoveryReady: false, complianceStatus: "needs_information", requiredActions: ["Upload current proof of address", "Confirm source of funds"], cardStatus: "pending", liquidAmount: "0.00", productiveAmount: "2500.00", connectedAmount: "8000.00", observationStatus: "pending", membership: { ...membership, tier: "Plus", score: 41 } },
  transfer_failed: { id: "transfer_failed", name: "Failed transfer", description: "A provider rejection exercises recovery messaging without changing balances.", customerName: "Alex Morgan", email: "alex@example.com", country: "PT", walletReady: true, passkeyReady: true, recoveryReady: true, complianceStatus: "approved", requiredActions: [], cardStatus: "active", liquidAmount: "28450.18", productiveAmount: "112840.24", connectedAmount: "43000.00", observationStatus: "confirmed", commandFailure: { code: "destination_rejected", message: "The destination could not be verified. No funds moved." }, membership }
};

export function isDemoScenarioId(value: string | null | undefined): value is DemoScenarioId { return Boolean(value && demoScenarioIds.includes(value as DemoScenarioId)); }
export function getScenario(id: DemoScenarioId): DemoScenario { return demoScenarios[id]; }
