import type { PositionObservation, ProductCommand, ProviderCommandReceipt, ProviderRegistry } from "./contracts";
import { createDemoRegistry } from "./demo";
import { getScenario, type DemoScenarioId } from "./scenarios";

export type ProductSession = {
  mode: "demo"; scenario: ReturnType<typeof getScenario>;
  profile: Awaited<ReturnType<ProviderRegistry["identity"]["getProfile"]>>;
  auth: Awaited<ReturnType<ProviderRegistry["identity"]["getSession"]>>;
  wallets: Awaited<ReturnType<ProviderRegistry["wallet"]["getWallets"]>>;
  compliance: Awaited<ReturnType<ProviderRegistry["compliance"]["getCase"]>>;
  card: Awaited<ReturnType<ProviderRegistry["card"]["getCard"]>>;
  membership: Awaited<ReturnType<ProviderRegistry["membership"]["getMembership"]>>;
  positions: PositionObservation[];
};

export async function buildDemoSession(scenarioId: DemoScenarioId, subjectReference = "demo-user-001"): Promise<ProductSession> {
  const providers = createDemoRegistry(scenarioId);
  const [profile, auth, wallets, compliance, card, membership, fiatPositions, walletPositions] = await Promise.all([
    providers.identity.getProfile(subjectReference), providers.identity.getSession(subjectReference), providers.wallet.getWallets(subjectReference),
    providers.compliance.getCase(subjectReference), providers.card.getCard(subjectReference), providers.membership.getMembership(subjectReference),
    providers.fiat.listPositions(subjectReference), providers.wallet.listPositions(subjectReference)
  ]);
  return { mode: "demo", scenario: getScenario(scenarioId), profile, auth, wallets, compliance, card, membership, positions: [...fiatPositions, ...walletPositions] };
}

export async function executeDemoCommand(scenarioId: DemoScenarioId, command: ProductCommand, idempotencyKey: string): Promise<ProviderCommandReceipt> {
  const providers = createDemoRegistry(scenarioId);
  switch (command.type) {
    case "start_compliance": return providers.compliance.execute(command, idempotencyKey);
    case "deposit": return providers.fiat.execute(command, idempotencyKey);
    case "issue_card": return providers.card.execute(command, idempotencyKey);
    case "create_wallet": case "withdraw": case "allocate": case "set_security_policy": return providers.wallet.execute(command, idempotencyKey);
  }
}
