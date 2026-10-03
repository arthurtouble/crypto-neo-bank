import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { relayPerpsActions } from "@/lib/markets/perps";

const schema = z.strictObject({ requestId: z.uuid(), signatures: z.array(z.string().regex(/^0x[0-9a-fA-F]{130}$/)).min(1).max(5) });

/** Send what the customer's device signed (an order, cancel, close, leverage, or auto-close Aura built) to Hyperliquid. */
export const POST = route("perps.relay", { invalid: "invalid_signature", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 60);
    const input = schema.parse(await readJsonBody(request));
    return Response.json({ ...await relayPerpsActions(env.PROJECTION_DB, subject, account.address, input.requestId, input.signatures), traceId },
      { status: 201 });
  });
