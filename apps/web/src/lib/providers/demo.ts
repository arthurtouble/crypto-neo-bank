import type { AuthSession, CardAccount, CardAdapter, ComplianceAdapter, ComplianceCase, CustomerProfile, FiatRailAdapter, IdentityAdapter, PositionObservation, ProductCommand, ProviderCommandReceipt, ProviderRegistry, WalletAccount, WalletAdapter } from "./contracts";
import { getScenario, type DemoScenarioId } from "./scenarios";

const observedAt = "2026-09-21T09:42:00.000Z";

function receipt(command: ProductCommand, provider: string, idempotencyKey: string, scenarioId: DemoScenarioId): ProviderCommandReceipt {
  const scenario = getScenario(scenarioId);
  if (scenario.commandFailure) return { commandId: idempotencyKey, type: command.type, provider, providerObjectId: `demo:${command.type}:${idempotencyKey}`, status: "failed", createdAt: new Date().toISOString(), failure: scenario.commandFailure };
  const nextAction = command.type === "withdraw" || command.type === "allocate" ? { type: "sign" as const, label: "Review and sign" } : command.type === "start_compliance" ? { type: "verify_identity" as const, label: "Continue verification" } : undefined;
  return { commandId: idempotencyKey, type: command.type, provider, providerObjectId: `demo:${command.type}:${idempotencyKey}`, status: nextAction ? "requires_action" : "accepted", createdAt: new Date().toISOString(), nextAction };
}

export class DemoIdentityAdapter implements IdentityAdapter {
  readonly name = "privy-simulator";
  constructor(private readonly scenarioId: DemoScenarioId) {}
  async getSession(subjectReference: string): Promise<AuthSession> { return { sessionReference: `demo-session:${subjectReference}`, subjectReference, assurance: getScenario(this.scenarioId).passkeyReady ? "passkey" : "email", expiresAt: "2026-09-22T09:42:00.000Z" }; }
  async getProfile(subjectReference: string): Promise<CustomerProfile> { const scenario = getScenario(this.scenarioId); return { subjectReference, displayName: scenario.customerName, email: scenario.email, country: scenario.country }; }
}

export class DemoWalletAdapter implements WalletAdapter {
  readonly name = "privy-wallet-simulator";
  constructor(private readonly scenarioId: DemoScenarioId) {}
  async getWallets(subjectReference: string): Promise<WalletAccount[]> { return getScenario(this.scenarioId).walletReady ? [{ walletReference: `wallet:${subjectReference}`, address: "0x91e2c6B8d2A91f4c08D9C7B08Ae37a10", chain: "Base", control: "embedded-noncustodial", recoveryReady: getScenario(this.scenarioId).recoveryReady }] : []; }
  async listPositions(subjectReference: string): Promise<PositionObservation[]> { const scenario = getScenario(this.scenarioId); if (!scenario.walletReady) return []; return [
    { asset: "USDC", amount: scenario.productiveAmount, decimals: 6, category: "productive", protocol: "Aave V3", chain: "Base", source: { kind: "chain", name: this.name, externalId: `position:${subjectReference}:aave-v3-base`, observedAt, status: scenario.observationStatus } }
  ]; }
  async execute(command: Extract<ProductCommand, { type: "create_wallet" | "withdraw" | "allocate" | "set_security_policy" }>, idempotencyKey: string) { return receipt(command, this.name, idempotencyKey, this.scenarioId); }
}

export class DemoComplianceAdapter implements ComplianceAdapter {
  readonly name = "bridge-compliance-simulator";
  constructor(private readonly scenarioId: DemoScenarioId) {}
  async getCase(subjectReference: string): Promise<ComplianceCase> { const scenario = getScenario(this.scenarioId); return { caseReference: `case:${subjectReference}`, status: scenario.complianceStatus, provider: this.name, requiredActions: scenario.requiredActions, reviewedAt: scenario.complianceStatus === "approved" ? observedAt : undefined }; }
  async execute(command: Extract<ProductCommand, { type: "start_compliance" }>, idempotencyKey: string) { return receipt(command, this.name, idempotencyKey, this.scenarioId); }
}

export class DemoFiatAdapter implements FiatRailAdapter {
  readonly name = "bridge-rails-simulator";
  constructor(private readonly scenarioId: DemoScenarioId) {}
  async listPositions(subjectReference: string): Promise<PositionObservation[]> { const scenario = getScenario(this.scenarioId); return scenario.complianceStatus === "approved" ? [{ asset: "USD", amount: scenario.liquidAmount, decimals: 2, category: "liquid", source: { kind: "provider", name: this.name, externalId: `virtual-account:${subjectReference}`, observedAt, status: scenario.observationStatus } }] : []; }
  async execute(command: Extract<ProductCommand, { type: "deposit" }>, idempotencyKey: string) { return receipt(command, this.name, idempotencyKey, this.scenarioId); }
}

export class DemoCardAdapter implements CardAdapter {
  readonly name = "bridge-card-simulator";
  constructor(private readonly scenarioId: DemoScenarioId) {}
  async getCard(subjectReference: string): Promise<CardAccount> { const scenario = getScenario(this.scenarioId); return { cardReference: `card:${subjectReference}`, status: scenario.cardStatus, lastFour: scenario.cardStatus === "active" ? "1842" : undefined, network: "visa", dailyLimit: "5000.00" }; }
  async execute(command: Extract<ProductCommand, { type: "issue_card" }>, idempotencyKey: string) { return receipt(command, this.name, idempotencyKey, this.scenarioId); }
}

export function createDemoRegistry(scenarioId: DemoScenarioId): ProviderRegistry { return { identity: new DemoIdentityAdapter(scenarioId), wallet: new DemoWalletAdapter(scenarioId), compliance: new DemoComplianceAdapter(scenarioId), fiat: new DemoFiatAdapter(scenarioId), card: new DemoCardAdapter(scenarioId) }; }
