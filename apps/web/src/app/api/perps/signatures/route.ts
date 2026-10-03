import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { completePerpsSignature } from "@/lib/markets/perps";

const schema = z.strictObject({ requestId: z.uuid(), authorization: z.string().min(1).max(4_000) });

/** Finish an approval or withdrawal the customer approved with their passkey, and send it to Hyperliquid. */
export const POST = route("perps.signatures", { invalid: "invalid_signature", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 10);
    const input = schema.parse(await readJsonBody(request));
    return Response.json({ ...await completePerpsSignature(env.PROJECTION_DB, subject, account, input.requestId, input.authorization), traceId });
  });
