import { env } from "cloudflare:workers";
import { z } from "zod";
import { AuthenticationError, requireVerifiedSubject } from "@/lib/auth/server";
import { BetaAccessError, requireBetaAccess } from "@/lib/beta/access";
import { createMarketOrderService, marketOrderRequestSchema, MarketOrderError } from "@/lib/markets/orders";

type Dependencies = {
  authenticate: (request: Request) => Promise<{ subjectReference: string }>;
  requireAccess: (subjectReference: string) => Promise<unknown>;
  createOrder: (subjectReference: string, value: unknown) => Promise<object>;
};

export function createOrdersHandler(dependencies: Dependencies) {
  return async function postOrder(request: Request) {
    const traceId = crypto.randomUUID();
    try {
      const subject = await dependencies.authenticate(request);
      await dependencies.requireAccess(subject.subjectReference);
      const value = marketOrderRequestSchema.parse(await request.json());
      const order = await dependencies.createOrder(subject.subjectReference, value);
      return Response.json({ order, authority: "Contracted regulated execution venue" }, { status: 201, headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      if (error instanceof AuthenticationError) return Response.json({ error: "unauthorized", traceId }, { status: 401, headers: { "Cache-Control": "no-store" } });
      if (error instanceof BetaAccessError) return Response.json({ error: error.code, traceId }, { status: 403, headers: { "Cache-Control": "no-store" } });
      if (error instanceof z.ZodError || error instanceof SyntaxError) return Response.json({ error: "invalid_order", traceId }, { status: 400, headers: { "Cache-Control": "no-store" } });
      if (error instanceof MarketOrderError) {
        const status = error.code === "eligibility_denied" ? 403 : error.code === "eligibility_stale" ? 409 : 503;
        return Response.json({ error: error.code, message: error.message, traceId }, { status, headers: { "Cache-Control": "no-store" } });
      }
      console.error(JSON.stringify({ level: "error", event: "markets.orders.failed", traceId, message: error instanceof Error ? error.message : "unknown" }));
      return Response.json({ error: "order_unavailable", traceId }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
  };
}

const service = createMarketOrderService();
export const POST = createOrdersHandler({
  authenticate: requireVerifiedSubject,
  requireAccess: (subjectReference) => requireBetaAccess(env.PROJECTION_DB, subjectReference),
  createOrder: (subjectReference, value) => service.create(subjectReference, value)
});
