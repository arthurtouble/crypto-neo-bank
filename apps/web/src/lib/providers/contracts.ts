export type SourceKind = "provider" | "chain" | "market-data";
export type ObservationStatus = "confirmed" | "pending" | "stale" | "unavailable";
export type CommandStatus = "accepted" | "requires_action" | "processing" | "completed" | "rejected" | "failed";
export type ComplianceStatus = "not_started" | "pending" | "needs_information" | "approved" | "rejected" | "restricted";

export type SourceReference = {
  kind: SourceKind;
  name: string;
  externalId: string;
  observedAt: string;
  status: ObservationStatus;
};

export type MoneyObservation = { asset: string; amount: string; decimals: number; source: SourceReference };
export type PositionObservation = MoneyObservation & { category: "liquid" | "productive" | "connected" | "borrowed"; protocol?: string; chain?: string };
export type CustomerProfile = { subjectReference: string; displayName: string; email: string; country: string };
export type AuthSession = { sessionReference: string; subjectReference: string; assurance: "email" | "passkey" | "step_up"; expiresAt: string };
export type WalletAccount = { walletReference: string; address: string; chain: string; control: "embedded-noncustodial" | "external-readonly" | "multisig"; recoveryReady: boolean };
export type ComplianceCase = { caseReference: string; status: ComplianceStatus; provider: string; requiredActions: string[]; reviewedAt?: string };
export type CardAccount = { cardReference: string; status: "not_eligible" | "eligible" | "pending" | "active" | "frozen"; lastFour?: string; network?: "visa" | "mastercard"; dailyLimit: string };
export type Membership = { tier: "Essential" | "Plus" | "Black" | "Private"; score: number; qualifyingBalance: string; renewalAt: string; entitlements: Array<{ name: string; status: "available" | "planned" | "in_review" }> };

export type ProductCommand =
  | { type: "create_wallet"; subjectReference: string }
  | { type: "start_compliance"; subjectReference: string; country: string }
  | { type: "deposit"; subjectReference: string; amount: string; asset: string; rail: "bank" | "wallet" }
  | { type: "withdraw"; subjectReference: string; amount: string; asset: string; destinationReference: string }
  | { type: "allocate"; subjectReference: string; amount: string; asset: string; strategyReference: string }
  | { type: "issue_card"; subjectReference: string }
  | { type: "set_security_policy"; subjectReference: string; policy: "allowlist" | "transfer_delay" | "passkey"; enabled: boolean };

export type ProviderCommandReceipt = {
  commandId: string;
  type: ProductCommand["type"];
  provider: string;
  providerObjectId: string;
  status: CommandStatus;
  createdAt: string;
  nextAction?: { type: "review" | "sign" | "verify_identity" | "wait"; label: string };
  failure?: { code: string; message: string };
};

export interface PortfolioSourceAdapter { readonly name: string; listPositions(subjectReference: string): Promise<PositionObservation[]> }
export interface IdentityAdapter { readonly name: string; getSession(subjectReference: string): Promise<AuthSession>; getProfile(subjectReference: string): Promise<CustomerProfile> }
export interface WalletAdapter extends PortfolioSourceAdapter { getWallets(subjectReference: string): Promise<WalletAccount[]>; execute(command: Extract<ProductCommand, { type: "create_wallet" | "withdraw" | "allocate" | "set_security_policy" }>, idempotencyKey: string): Promise<ProviderCommandReceipt> }
export interface ComplianceAdapter { readonly name: string; getCase(subjectReference: string): Promise<ComplianceCase>; execute(command: Extract<ProductCommand, { type: "start_compliance" }>, idempotencyKey: string): Promise<ProviderCommandReceipt> }
export interface FiatRailAdapter extends PortfolioSourceAdapter { execute(command: Extract<ProductCommand, { type: "deposit" }>, idempotencyKey: string): Promise<ProviderCommandReceipt> }
export interface CardAdapter { readonly name: string; getCard(subjectReference: string): Promise<CardAccount>; execute(command: Extract<ProductCommand, { type: "issue_card" }>, idempotencyKey: string): Promise<ProviderCommandReceipt> }
export interface MembershipAdapter { readonly name: string; getMembership(subjectReference: string): Promise<Membership> }
export type ProviderRegistry = { identity: IdentityAdapter; wallet: WalletAdapter; compliance: ComplianceAdapter; fiat: FiatRailAdapter; card: CardAdapter; membership: MembershipAdapter };
