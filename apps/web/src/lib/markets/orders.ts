import { z } from "zod";
import type { RegulatedEligibilityResult } from "@/lib/markets/eligibility";

export const marketOrderRequestSchema = z.object({
  instrumentId: z.string().regex(/^xstocks:[A-Za-z0-9._:-]{1,160}$/),
  side: z.enum(["buy", "sell"]),
  network: z.string().min(1).max(40),
  quantity: z.string().regex(/^\d+(?:\.\d{1,18})?$/).optional(),
  cashAmount: z.string().regex(/^\d+(?:\.\d{1,18})?$/).optional(),
  paymentWalletIdentifier: z.string().min(1).max(160),
  receivingWalletIdentifier: z.string().min(1).max(160),
  idempotencyKey: z.string().uuid()
}).strict()
  .refine((value) => Boolean(value.quantity) !== Boolean(value.cashAmount), { message: "Provide exactly one order amount." })
  .refine((value) => /[1-9]/.test(value.quantity ?? value.cashAmount ?? ""), { message: "Order amount must be greater than zero." });

export type MarketOrderRequest = z.infer<typeof marketOrderRequestSchema>;
const marketOrderSchema = z.object({
  providerOrderReference: z.string().min(1).max(160), venue: z.string().min(1).max(120),
  status: z.enum(["pending", "open", "partially_filled", "filled", "cancelled", "failed"]),
  expiresAt: z.string().datetime(), settlementAsset: z.string().min(1).max(40),
  feeAmount: z.string().regex(/^\d+(?:\.\d{1,18})?$/).nullable(), feeCurrency: z.string().min(1).max(20).nullable()
}).strict();
export type MarketOrder = z.infer<typeof marketOrderSchema>;

export type MarketExecutionAdapter = {
  availability(): { contracted: boolean; venue: string | null; legalApprovalReference: string | null; limitsVersion: string | null };
  create(input: MarketOrderRequest & { subjectReference: string; eligibilityDecisionReference: string }): Promise<MarketOrder>;
  cancel(input: { subjectReference: string; providerOrderReference: string }): Promise<MarketOrder>;
  status(input: { subjectReference: string; providerOrderReference: string }): Promise<MarketOrder>;
};

export class MarketOrderError extends Error {
  constructor(public readonly code: "orders_disabled" | "eligibility_denied" | "eligibility_stale" | "venue_not_connected" | "wallet_not_verified" | "order_unavailable", message: string) {
    super(message);
    this.name = "MarketOrderError";
  }
}

export function createUnavailableMarketExecutionAdapter(): MarketExecutionAdapter {
  const unavailable = async (): Promise<never> => { throw new MarketOrderError("venue_not_connected", "No contracted regulated execution venue is connected."); };
  return {
    availability: () => ({ contracted: false, venue: null, legalApprovalReference: null, limitsVersion: null }),
    create: unavailable, cancel: unavailable, status: unavailable
  };
}

type Dependencies = {
  enabled?: () => boolean;
  now?: () => number;
  eligibility?: (subjectReference: string, instrumentId: string) => Promise<RegulatedEligibilityResult>;
  adapter?: MarketExecutionAdapter;
  walletOwnership?: (input: { subjectReference: string; network: string; paymentWalletIdentifier: string; receivingWalletIdentifier: string }) => Promise<boolean>;
};

export function createMarketOrderService(dependencies: Dependencies = {}) {
  const enabled = dependencies.enabled ?? (() => process.env.AUREL_REGULATED_ORDERS_ENABLED === "true");
  const now = dependencies.now ?? Date.now;
  const eligibility = dependencies.eligibility ?? (async () => { throw new MarketOrderError("eligibility_denied", "A current regulated eligibility decision is required."); });
  const adapter = dependencies.adapter ?? createUnavailableMarketExecutionAdapter();
  const walletOwnership = dependencies.walletOwnership ?? (async () => false);
  return {
    async create(subjectReference: string, value: unknown): Promise<MarketOrder> {
      const input = marketOrderRequestSchema.parse(value);
      if (!enabled()) throw new MarketOrderError("orders_disabled", "Regulated orders are not enabled.");
      const decision = await eligibility(subjectReference, input.instrumentId);
      if (decision.subjectReference !== subjectReference || decision.instrumentId !== input.instrumentId) {
        throw new MarketOrderError("eligibility_denied", "The eligibility decision does not match this account and instrument.");
      }
      const eligibilityExpiry = Date.parse(decision.expiresAt ?? "");
      if (!Number.isFinite(eligibilityExpiry) || eligibilityExpiry <= now()) throw new MarketOrderError("eligibility_stale", "The regulated eligibility decision has expired.");
      if (!decision.permissions.canOrder || !decision.decisionReference?.trim() || !decision.evidenceReference?.trim() || !decision.ruleVersion?.trim()) {
        throw new MarketOrderError("eligibility_denied", "This account is not permitted to place this order.");
      }
      const availability = adapter.availability();
      if (!availability.contracted || !availability.venue || !availability.legalApprovalReference || !availability.limitsVersion) {
        throw new MarketOrderError("venue_not_connected", "No contracted regulated execution venue is connected.");
      }
      if (!await walletOwnership({ subjectReference, network: input.network, paymentWalletIdentifier: input.paymentWalletIdentifier, receivingWalletIdentifier: input.receivingWalletIdentifier })) {
        throw new MarketOrderError("wallet_not_verified", "The order wallets are not verified for this account.");
      }
      try {
        const order = marketOrderSchema.safeParse(await adapter.create({ ...input, subjectReference, eligibilityDecisionReference: decision.decisionReference }));
        if (!order.success || Date.parse(order.data.expiresAt) <= now()) throw new Error("invalid provider order");
        return order.data;
      } catch (error) {
        if (error instanceof MarketOrderError) throw error;
        throw new MarketOrderError("order_unavailable", "The regulated order venue is unavailable.");
      }
    }
  };
}
