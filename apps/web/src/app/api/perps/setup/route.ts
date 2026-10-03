import { env } from "cloudflare:workers";
import { requireProviderPlace } from "@/lib/legal/places";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPerpsSetup } from "@/lib/markets/perps";

const schema = z.strictObject({ agent: z.string().regex(/^0x[0-9a-fA-F]{40}$/) });

/** Connect this device's trading key (`agent`) to the customer's Hyperliquid account: returns the approval for their passkey, or ready. */
export const POST = route("perps.setup", { invalid: "invalid_agent", unavailable: "perps_unavailable", onError: venueErrorResponse }, async (request, { traceId }) => {
  const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 10);
  requireProviderPlace(request, "perps");
  const { agent } = schema.parse(await readJsonBody(request));
  return Response.json({ ...await startPerpsSetup(env.PROJECTION_DB, subject, account, agent), traceId });
});
