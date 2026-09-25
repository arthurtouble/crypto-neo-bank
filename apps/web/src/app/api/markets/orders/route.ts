import { env } from "cloudflare:workers";
import { requireVerifiedSubject } from "@/lib/auth/server";
import { requireFeature } from "@/lib/features/flags";
import { errorResponse, route } from "@/lib/http/route";
import { createMarketOrderService, marketOrderRequestSchema, MarketOrderError } from "@/lib/markets/orders";

type Dependencies = {
  authenticate: (request: Request) => Promise<{ subjectReference: string }>;
  requireEnabled: () => Promise<unknown>;
  createOrder: (subjectReference: string, value: unknown) => Promise<object>;
};

export function createOrdersHandler(dependencies: Dependencies) {
  return route("markets.orders", {
    invalid: "invalid_order", unavailable: "order_unavailable",
    onError: (error, context) => error instanceof MarketOrderError
      ? errorResponse(error.code === "eligibility_denied" ? 403 : error.code === "eligibility_stale" ? 409 : 503, error.code, context, { message: error.message })
      : undefined
  }, async (request: Request) => {
    const subject = await dependencies.authenticate(request);
    await dependencies.requireEnabled();
    const value = marketOrderRequestSchema.parse(await request.json());
    const order = await dependencies.createOrder(subject.subjectReference, value);
    return Response.json({ order, authority: "Contracted regulated execution venue" }, { status: 201 });
  });
}

const service = createMarketOrderService();
export const POST = createOrdersHandler({
  authenticate: requireVerifiedSubject,
  requireEnabled: () => requireFeature(env.PROJECTION_DB, "tokenized_markets"),
  createOrder: (subjectReference, value) => service.create(subjectReference, value)
});
