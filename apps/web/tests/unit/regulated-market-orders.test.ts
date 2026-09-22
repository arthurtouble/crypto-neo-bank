import { describe, expect, it, vi } from "vitest";
import { createMarketOrderService, MarketOrderError, marketOrderRequestSchema } from "@/lib/markets/orders";

const request = {
  instrumentId: "xstocks:issuer-aapl", side: "buy" as const, cashAmount: "1000", network: "Base",
  paymentWalletIdentifier: "0x1111111111111111111111111111111111111111",
  receivingWalletIdentifier: "0x1111111111111111111111111111111111111111",
  idempotencyKey: "0199b2c0-9c31-7000-8000-000000000001"
};

const allowed = {
  subjectReference: "did:privy:subject-1", instrumentId: request.instrumentId,
  permissions: { canQuote: true, canOrder: true, canHold: true, canTransfer: true }, reasons: [],
  ruleVersion: "rules-v1", decisionReference: "decision-1", evidenceReference: "evidence-1",
  evaluatedAt: "2026-09-22T11:59:00.000Z", expiresAt: "2026-09-22T12:15:00.000Z"
};

describe("regulated market order boundary", () => {
  it("rejects generic router quote or calldata fields", () => {
    expect(() => marketOrderRequestSchema.parse({ ...request, transactionRequest: { to: request.paymentWalletIdentifier, data: "0x" } })).toThrow();
    expect(() => marketOrderRequestSchema.parse({ ...request, lifiQuoteId: "quote-1" })).toThrow();
  });

  it("requires quantity and cash amounts to be greater than zero", () => {
    expect(() => marketOrderRequestSchema.parse({ ...request, cashAmount: "0" })).toThrow();
    const quantityRequest: Record<string, unknown> = { ...request };
    delete quantityRequest.cashAmount;
    expect(() => marketOrderRequestSchema.parse({ ...quantityRequest, quantity: "0.000" })).toThrow();
  });

  it("does not let an admin switch create an order without a contracted venue", async () => {
    const service = createMarketOrderService({
      enabled: () => true, now: () => Date.parse("2026-09-22T12:00:00.000Z"),
      eligibility: async () => allowed
    });
    await expect(service.create("did:privy:subject-1", request)).rejects.toBeInstanceOf(MarketOrderError);
    await expect(service.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "venue_not_connected" });
  });

  it("never calls a venue when the provider decision is denied or stale", async () => {
    const create = vi.fn();
    const adapter = { availability: () => ({ contracted: true as const, venue: "venue-1", legalApprovalReference: "legal-1", limitsVersion: "limits-1" }), create, cancel: vi.fn(), status: vi.fn() };
    const service = createMarketOrderService({
      enabled: () => true, adapter, now: () => Date.parse("2026-09-22T12:00:00.000Z"),
      eligibility: async () => ({ ...allowed, permissions: { ...allowed.permissions, canOrder: false }, reasons: ["document_acknowledgement_required"] })
    });
    await expect(service.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "eligibility_denied" });
    expect(create).not.toHaveBeenCalled();

    const stale = createMarketOrderService({ enabled: () => true, adapter, now: () => Date.parse("2026-09-22T12:16:00.000Z"), eligibility: async () => allowed });
    await expect(stale.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "eligibility_stale" });
    expect(create).not.toHaveBeenCalled();

    const malformed = createMarketOrderService({ enabled: () => true, adapter, now: () => Date.parse("2026-09-22T12:00:00.000Z"), eligibility: async () => ({ ...allowed, expiresAt: "invalid" }) });
    await expect(malformed.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "eligibility_stale" });
    expect(create).not.toHaveBeenCalled();
  });

  it("independently binds the decision to the authenticated subject and instrument", async () => {
    const adapter = { availability: () => ({ contracted: true as const, venue: "venue-1", legalApprovalReference: "legal-1", limitsVersion: "limits-1" }), create: vi.fn(), cancel: vi.fn(), status: vi.fn() };
    const wrongSubject = createMarketOrderService({ enabled: () => true, adapter, eligibility: async () => ({ ...allowed, subjectReference: "did:privy:other" }) });
    await expect(wrongSubject.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "eligibility_denied" });
    const wrongInstrument = createMarketOrderService({ enabled: () => true, adapter, eligibility: async () => ({ ...allowed, instrumentId: "xstocks:issuer-other" }) });
    await expect(wrongInstrument.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "eligibility_denied" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("requires the separate regulated-orders switch even with provider and venue approval", async () => {
    const adapter = { availability: () => ({ contracted: true as const, venue: "venue-1", legalApprovalReference: "legal-1", limitsVersion: "limits-1" }), create: vi.fn(), cancel: vi.fn(), status: vi.fn() };
    const service = createMarketOrderService({ enabled: () => false, adapter, now: () => Date.parse("2026-09-22T12:00:00.000Z"), eligibility: async () => allowed });
    await expect(service.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "orders_disabled" });
    expect(adapter.create).not.toHaveBeenCalled();
  });

  it("rejects an unverified destination and malformed provider order result", async () => {
    const malformedAdapter = {
      availability: () => ({ contracted: true as const, venue: "venue-1", legalApprovalReference: "legal-1", limitsVersion: "limits-1" }),
      create: vi.fn(async () => ({ providerOrderReference: "order-1", venue: "venue-1", status: "pending" as const, expiresAt: "2026-09-22T12:10:00.000Z", settlementAsset: "USDC", feeAmount: null, feeCurrency: null, transactionRequest: { data: "0x1234" } })),
      cancel: vi.fn(), status: vi.fn()
    };
    const destinationDenied = createMarketOrderService({ enabled: () => true, adapter: malformedAdapter, now: () => Date.parse("2026-09-22T12:00:00.000Z"), eligibility: async () => allowed, walletOwnership: async () => false });
    await expect(destinationDenied.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "wallet_not_verified" });
    expect(malformedAdapter.create).not.toHaveBeenCalled();

    const malformedResult = createMarketOrderService({ enabled: () => true, adapter: malformedAdapter, now: () => Date.parse("2026-09-22T12:00:00.000Z"), eligibility: async () => allowed, walletOwnership: async () => true });
    await expect(malformedResult.create("did:privy:subject-1", request)).rejects.toMatchObject({ code: "order_unavailable" });
  });
});
