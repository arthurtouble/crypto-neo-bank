import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { claimProviderCommand, settleProviderCommand, type CommandClaim } from "@aurel/provider-projections";
import { requireFeature } from "@/lib/features/flags";
import { errorResponse, route } from "@/lib/http/route";
import { createMarketOrderService, marketOrderRequestSchema, MarketOrderError } from "@/lib/markets/orders";

type Dependencies = {
  authenticate: (request: Request) => Promise<{ subjectReference: string }>;
  requireEnabled: () => Promise<unknown>;
  createOrder: (subjectReference: string, value: unknown) => Promise<{ providerOrderReference: string }>;
  commands: {
    claim: (subjectReference: string, idempotencyKey: string) => Promise<CommandClaim>;
    settle: (key: string, result: { status: "completed" | "failed"; providerObjectId?: string }) => Promise<void>;
  };
};

export function createOrdersHandler(dependencies: Dependencies) {
  return route("markets.orders", {
    invalid: "invalid_order", unavailable: "order_unavailable",
    onError: (error, context) => error instanceof MarketOrderError
      ? errorResponse(error.code === "eligibility_denied" ? 403 : error.code === "eligibility_stale" ? 409 : 503, error.code, context, { message: error.message })
      : undefined
  }, async (request: Request, context) => {
    const subject = await dependencies.authenticate(request);
    await dependencies.requireEnabled();
    const value = marketOrderRequestSchema.parse(await request.json());
    // A retried request with the same key never reaches the venue twice.
    const claim = await dependencies.commands.claim(subject.subjectReference, value.idempotencyKey);
    if (claim.outcome === "completed") return Response.json({ order: { providerOrderReference: claim.providerObjectId }, duplicate: true });
    if (claim.outcome === "in_progress") return errorResponse(409, "order_in_progress", context);
    let order: { providerOrderReference: string };
    try { order = await dependencies.createOrder(subject.subjectReference, value); }
    catch (error) { await dependencies.commands.settle(claim.key, { status: "failed" }); throw error; }
    await dependencies.commands.settle(claim.key, { status: "completed", providerObjectId: order.providerOrderReference });
    return Response.json({ order, authority: "Contracted regulated execution venue" }, { status: 201 });
  });
}

const service = createMarketOrderService();
export const POST = createOrdersHandler({
  authenticate: requireVerifiedSubject,
  requireEnabled: () => requireFeature(env.PROJECTION_DB, "tokenized_markets"),
  createOrder: (subjectReference, value) => service.create(subjectReference, value),
  commands: {
    claim: (subjectReference, idempotencyKey) => claimProviderCommand(env.PROJECTION_DB, { subjectReference, idempotencyKey,
      commandType: "market_order", provider: "regulated_venue" }),
    settle: (key, result) => settleProviderCommand(env.PROJECTION_DB, key, result)
  }
});
