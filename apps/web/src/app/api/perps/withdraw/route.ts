import { env } from "cloudflare:workers";
import { z } from "zod";
import { readJsonBody, route } from "@/lib/http/route";
import { marketActor } from "@/lib/markets/guard";
import { venueErrorResponse } from "@/lib/markets/http";
import { startPerpsWithdrawal } from "@/lib/markets/perps";

const schema = z.strictObject({ amount: z.string().regex(/^\d+(\.\d{1,6})?$/).max(24) });

/** A withdrawal from Hyperliquid to the account on Base, for the customer's passkey to approve. */
export const POST = route("perps.withdraw", { invalid: "invalid_withdrawal", unavailable: "perps_unavailable", onError: venueErrorResponse },
  async (request, { traceId }) => {
    const { subject, account } = await marketActor(env.PROJECTION_DB, request, "perps", 10);
    const { amount } = schema.parse(await readJsonBody(request));
    return Response.json({ ...await startPerpsWithdrawal(env.PROJECTION_DB, subject, account, amount), traceId });
  });
